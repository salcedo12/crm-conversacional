import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import type { StyleProp, TextStyle } from 'react-native';

export type LucideIconName =
  | 'LayoutDashboard'
  | 'MessageSquare'
  | 'MessageCircle'
  | 'ClipboardCheck'
  | 'ClipboardList'
  | 'Layers'
  | 'Users'
  | 'User'
  | 'UserPlus'
  | 'Calendar'
  | 'Database'
  | 'Phone'
  | 'PhoneCall'
  | 'PhoneOff'
  | 'PhoneIncoming'
  | 'TrendingUp'
  | 'FileText'
  | 'LayoutTemplate'
  | 'Megaphone'
  | 'Settings'
  | 'LogOut'
  | 'Menu'
  | 'AlertTriangle'
  | 'AlertCircle'
  | 'Moon'
  | 'Sun'
  | 'Eye'
  | 'EyeOff'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ChevronDown'
  | 'ChevronUp'
  | 'ChevronLeft'
  | 'ChevronRight'
  | 'Search'
  | 'Check'
  | 'CheckCheck'
  | 'X'
  | 'Plus'
  | 'Minus'
  | 'RefreshCw'
  | 'Filter'
  | 'Send'
  | 'Paperclip'
  | 'FolderOpen'
  | 'Folder'
  | 'Mic'
  | 'MicOff'
  | 'Trash2'
  | 'Edit2'
  | 'Pencil'
  | 'Copy'
  | 'ExternalLink'
  | 'Clock'
  | 'Lock'
  | 'Unlock'
  | 'Download'
  | 'Upload'
  | 'Camera'
  | 'Image'
  | 'Video'
  | 'Play'
  | 'Pause'
  | 'Square'
  | 'Bot'
  | 'Sparkles'
  | 'Trophy'
  | 'Target'
  | 'Award'
  | 'Gift'
  | 'MapPin'
  | 'Smile'
  | 'Bell'
  | 'Shield'
  | 'Building2'
  | 'Sliders'
  | 'Tag'
  | 'Share2'
  | 'Info'
  | 'LogIn'
  | 'CheckCircle'
  | 'CheckCircle2'
  | 'DollarSign'
  | 'MousePointerClick'
  | 'Zap'
  | 'Lightbulb'
  | 'FileSpreadsheet'
  | 'ArrowRightLeft'
  | 'UserCheck'
  | 'UserX'
  | 'History'
  | 'PhoneMissed'
  | 'Handshake';

interface IconProps {
  name: LucideIconName;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}

const MCI_MAP: Partial<Record<LucideIconName, keyof typeof MaterialCommunityIcons.glyphMap>> = {
  LayoutDashboard: 'view-dashboard-outline',
  ClipboardCheck: 'clipboard-check-outline',
  ClipboardList: 'clipboard-text-outline',
  LayoutTemplate: 'view-quilt-outline',
  Megaphone: 'bullhorn-outline',
  CheckCheck: 'check-all',
  Bot: 'robot-outline',
  Sparkles: 'auto-fix',
  Trophy: 'trophy-outline',
  Building2: 'domain',
  Lightbulb: 'lightbulb-outline',
  FileSpreadsheet: 'file-excel-outline',
  ArrowRightLeft: 'swap-horizontal',
  UserCheck: 'account-check-outline',
  UserX: 'account-remove-outline',
  History: 'history',
  PhoneMissed: 'phone-missed',
  Handshake: 'handshake-outline',
};

const FEATHER_MAP: Record<Exclude<LucideIconName, keyof typeof MCI_MAP>, keyof typeof Feather.glyphMap> = {
  MessageSquare: 'message-square',
  MessageCircle: 'message-circle',
  Layers: 'layers',
  Users: 'users',
  User: 'user',
  UserPlus: 'user-plus',
  Calendar: 'calendar',
  Database: 'database',
  Phone: 'phone',
  PhoneCall: 'phone-call',
  PhoneOff: 'phone-off',
  PhoneIncoming: 'phone-incoming',
  TrendingUp: 'trending-up',
  FileText: 'file-text',
  Settings: 'settings',
  LogOut: 'log-out',
  Menu: 'menu',
  AlertTriangle: 'alert-triangle',
  AlertCircle: 'alert-circle',
  Moon: 'moon',
  Sun: 'sun',
  Eye: 'eye',
  EyeOff: 'eye-off',
  ArrowLeft: 'arrow-left',
  ArrowRight: 'arrow-right',
  ChevronDown: 'chevron-down',
  ChevronUp: 'chevron-up',
  ChevronLeft: 'chevron-left',
  ChevronRight: 'chevron-right',
  Search: 'search',
  Check: 'check',
  X: 'x',
  Plus: 'plus',
  Minus: 'minus',
  RefreshCw: 'refresh-cw',
  Filter: 'filter',
  Send: 'send',
  Paperclip: 'paperclip',
  FolderOpen: 'folder',
  Folder: 'folder',
  Mic: 'mic',
  MicOff: 'mic-off',
  Trash2: 'trash-2',
  Edit2: 'edit-2',
  Pencil: 'edit-2',
  Copy: 'copy',
  ExternalLink: 'external-link',
  Clock: 'clock',
  Lock: 'lock',
  Unlock: 'unlock',
  Download: 'download',
  Upload: 'upload',
  Camera: 'camera',
  Image: 'image',
  Video: 'video',
  Play: 'play',
  Pause: 'pause',
  Square: 'square',
  Target: 'target',
  Award: 'award',
  Gift: 'gift',
  MapPin: 'map-pin',
  Smile: 'smile',
  Bell: 'bell',
  Shield: 'shield',
  Sliders: 'sliders',
  Tag: 'tag',
  Share2: 'share-2',
  Info: 'info',
  LogIn: 'log-in',
  CheckCircle: 'check-circle',
  CheckCircle2: 'check-circle',
  DollarSign: 'dollar-sign',
  MousePointerClick: 'mouse-pointer',
  Zap: 'zap',
};

export function Icon({ name, size = 18, color = '#d4d4d8', style }: IconProps) {
  const mciGlyph = MCI_MAP[name];
  if (mciGlyph) {
    return <MaterialCommunityIcons name={mciGlyph} size={size} color={color} style={style} />;
  }
  const featherGlyph = FEATHER_MAP[name as Exclude<LucideIconName, keyof typeof MCI_MAP>] ?? 'circle';
  return <Feather name={featherGlyph} size={size} color={color} style={style} />;
}
