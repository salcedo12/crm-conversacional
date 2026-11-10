import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  COUNTRY_PREFIX_OPTIONS,
  detectCountryFromInput,
  getCountryByIso,
  isoToFlagEmoji,
  type CountryPrefixOption,
} from '../services/contacts';
import { useTheme } from '../providers/ThemeProvider';
import { Icon } from './Icon';

interface CountryPhoneInputProps {
  countryIso: string;
  onCountryChange: (iso: string) => void;
  phone: string;
  onPhoneChange: (localDigits: string) => void;
  onSubmitEditing?: () => void;
  statusBorder?: 'available' | 'reclaimable' | 'locked_by_other' | 'default';
}

function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function CountryPhoneInput({
  countryIso,
  onCountryChange,
  phone,
  onPhoneChange,
  onSubmitEditing,
  statusBorder = 'default',
}: CountryPhoneInputProps) {
  const { palette } = useTheme();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selectedCountry = useMemo(() => getCountryByIso(countryIso), [countryIso]);

  const filteredCountries = useMemo(() => {
    const q = normalizeSearch(search);
    if (!q) return COUNTRY_PREFIX_OPTIONS;
    return COUNTRY_PREFIX_OPTIONS.filter((c) => {
      const nameNorm = normalizeSearch(c.name);
      const isoNorm = c.iso.toLowerCase();
      const codeNorm = c.code.toLowerCase();
      const codeDigits = c.code.replace(/\D/g, '');
      const qDigits = q.replace(/\D/g, '');
      return (
        nameNorm.includes(q) ||
        isoNorm === q ||
        codeNorm.includes(q) ||
        (qDigits.length > 0 && codeDigits.startsWith(qDigits))
      );
    });
  }, [search]);

  const handleInput = (rawVal: string) => {
    const detected = detectCountryFromInput(rawVal, selectedCountry.iso);
    if (detected.iso.toLowerCase() !== selectedCountry.iso.toLowerCase()) {
      onCountryChange(detected.iso);
    }
    onPhoneChange(detected.localDigits);
  };

  const handleSelectCountry = (opt: CountryPrefixOption) => {
    onCountryChange(opt.iso);
    const clean = phone.replace(/\D/g, '').slice(0, opt.maxDigits);
    if (clean !== phone) onPhoneChange(clean);
    setOpen(false);
  };

  const borderColor =
    statusBorder === 'available'
      ? palette.emerald
      : statusBorder === 'reclaimable'
      ? palette.amber
      : statusBorder === 'locked_by_other'
      ? palette.rose
      : palette.borderInput;

  const digitsCount = phone.replace(/\D/g, '').length;
  const digitRangeText =
    selectedCountry.minDigits === selectedCountry.maxDigits
      ? `${selectedCountry.minDigits} dígitos`
      : `${selectedCountry.minDigits}-${selectedCountry.maxDigits} dígitos`;

  return (
    <View>
      <View style={styles.row}>
        <Pressable
          onPress={() => {
            setSearch('');
            setOpen(true);
          }}
          style={[
            styles.countryBtn,
            { backgroundColor: palette.bgInput, borderColor: palette.borderInput },
          ]}
        >
          <View style={styles.countryLeft}>
            <Text style={styles.flag}>{isoToFlagEmoji(selectedCountry.iso)}</Text>
            <Text style={[styles.code, { color: palette.textPrimary }]}>{selectedCountry.code}</Text>
          </View>
          <Icon name="ChevronDown" size={13} color={palette.textMuted} />
        </Pressable>

        <TextInput
          value={phone}
          onChangeText={handleInput}
          keyboardType="phone-pad"
          placeholder={`Ej: ${selectedCountry.placeholder}`}
          placeholderTextColor={palette.placeholder}
          onSubmitEditing={onSubmitEditing}
          style={[
            styles.input,
            {
              backgroundColor: palette.bgInput,
              borderColor,
              color: palette.textPrimary,
            },
          ]}
        />
      </View>

      <View style={styles.metaRow}>
        <Text style={[styles.metaText, { color: palette.textSubtle }]} numberOfLines={1}>
          País: <Text style={{ color: palette.textMuted, fontWeight: '700' }}>{selectedCountry.name}</Text> ({digitRangeText})
        </Text>
        {digitsCount > 0 && digitsCount < selectedCountry.minDigits && (
          <Text style={[styles.missingText, { color: palette.amberText }]}>
            Faltan {selectedCountry.minDigits - digitsCount} dígito{selectedCountry.minDigits - digitsCount === 1 ? '' : 's'}
          </Text>
        )}
      </View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={[styles.backdrop, { backgroundColor: palette.backdrop }]} onPress={() => setOpen(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: palette.bgCard, borderColor: palette.border }]}
            onPress={() => {}}
          >
            <View style={[styles.sheetHeader, { borderBottomColor: palette.border }]}>
              <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>Seleccionar país / indicativo</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={10}>
                <Icon name="X" size={18} color={palette.textMuted} />
              </Pressable>
            </View>

            <View style={[styles.searchBox, { backgroundColor: palette.bgInput, borderColor: palette.borderInput }]}>
              <Icon name="Search" size={14} color={palette.textMuted} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Buscar país o indicativo (+57, +1, España)..."
                placeholderTextColor={palette.placeholder}
                style={[styles.searchInput, { color: palette.textPrimary }]}
                autoFocus
              />
            </View>

            <FlatList
              data={filteredCountries}
              keyExtractor={(item) => `${item.iso}-${item.code}`}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const isSelected = item.iso.toLowerCase() === selectedCountry.iso.toLowerCase();
                return (
                  <Pressable
                    onPress={() => handleSelectCountry(item)}
                    style={[
                      styles.optionRow,
                      { borderBottomColor: palette.border },
                      isSelected && { backgroundColor: palette.brandSoft },
                    ]}
                  >
                    <View style={styles.optionLeft}>
                      <Text style={styles.flag}>{isoToFlagEmoji(item.iso)}</Text>
                      <Text
                        style={[
                          styles.optionName,
                          { color: isSelected ? palette.brandText : palette.textPrimary },
                          isSelected && { fontWeight: '700' },
                        ]}
                      >
                        {item.name}
                      </Text>
                    </View>
                    <View style={styles.optionRight}>
                      <View style={[styles.codeBadge, { backgroundColor: palette.bgElevated }]}>
                        <Text style={[styles.codeBadgeText, { color: palette.textMuted }]}>{item.code}</Text>
                      </View>
                      {isSelected && <Icon name="Check" size={14} color={palette.brand} />}
                    </View>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyBox}>
                  <Text style={{ color: palette.textSubtle, fontSize: 12 }}>
                    No se encontró ningún país con "{search}"
                  </Text>
                </View>
              }
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 6,
  },
  countryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    minWidth: 96,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
  },
  countryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  flag: {
    fontSize: 15,
  },
  code: {
    fontSize: 12,
    fontWeight: '700',
  },
  input: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
  },
  metaRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  metaText: {
    fontSize: 10,
    flex: 1,
  },
  missingText: {
    fontSize: 10,
    fontWeight: '600',
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '72%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    paddingBottom: 24,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  sheetTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    padding: 0,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  optionName: {
    fontSize: 13,
  },
  optionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  codeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  codeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  emptyBox: {
    padding: 24,
    alignItems: 'center',
  },
});
