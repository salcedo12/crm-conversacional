const { withAppBuildGradle, withGradleProperties } = require('@expo/config-plugins');

const SIGNING_HELPER_MARKER = 'MERAKI_RELEASE_SIGNING_HELPER';
const RELEASE_CONFIG_MARKER = 'MERAKI_RELEASE_SIGNING_CONFIG';

function findBlockEnd(contents, openBraceIndex) {
  let depth = 0;
  for (let index = openBraceIndex; index < contents.length; index += 1) {
    const char = contents[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findNamedBlock(contents, name, startIndex = 0) {
  const pattern = new RegExp(`\\b${name}\\s*\\{`, 'g');
  pattern.lastIndex = startIndex;
  const match = pattern.exec(contents);
  if (!match) return null;

  const openBraceIndex = contents.indexOf('{', match.index);
  const endIndex = findBlockEnd(contents, openBraceIndex);
  if (endIndex === -1) return null;

  return { start: match.index, openBraceIndex, end: endIndex };
}

function ensureSigningHelper(contents) {
  if (contents.includes(SIGNING_HELPER_MARKER)) return contents;

  const helper = `
// ${SIGNING_HELPER_MARKER}
def merakiReleaseProperties = new Properties()
def merakiReleasePropertiesFile = rootProject.file("../meraki-release.properties")
if (merakiReleasePropertiesFile.exists()) {
    merakiReleasePropertiesFile.withInputStream { merakiReleaseProperties.load(it) }
}
def merakiReleaseProperty = { name ->
    def value = findProperty(name)
    if (value == null || value.toString().trim().isEmpty()) {
        value = merakiReleaseProperties.getProperty(name)
    }
    return value
}
def merakiReleaseStoreFileProp = merakiReleaseProperty('MERAKI_RELEASE_STORE_FILE')
def merakiReleaseStoreFile = merakiReleaseStoreFileProp ? rootProject.file("../" + merakiReleaseStoreFileProp) : null
def merakiUseReleaseSigning = merakiReleaseStoreFile != null && merakiReleaseStoreFile.exists()
`;

  const jscLine = "def jscFlavor = 'io.github.react-native-community:jsc-android:2026004.+'";
  if (contents.includes(jscLine)) {
    return contents.replace(jscLine, `${jscLine}\n${helper}`);
  }

  return `${helper}\n${contents}`;
}

function ensureReleaseSigningConfig(contents) {
  const signingConfigsBlock = findNamedBlock(contents, 'signingConfigs');
  if (!signingConfigsBlock) return contents;

  const blockText = contents.slice(signingConfigsBlock.start, signingConfigsBlock.end + 1);
  if (blockText.includes(RELEASE_CONFIG_MARKER)) return contents;

  const releaseConfig = `
        // ${RELEASE_CONFIG_MARKER}
        if (merakiUseReleaseSigning) {
            release {
                storeFile merakiReleaseStoreFile
                storePassword merakiReleaseProperty('MERAKI_RELEASE_STORE_PASSWORD')
                keyAlias merakiReleaseProperty('MERAKI_RELEASE_KEY_ALIAS')
                keyPassword merakiReleaseProperty('MERAKI_RELEASE_KEY_PASSWORD')
            }
        }
`;

  return `${contents.slice(0, signingConfigsBlock.end)}${releaseConfig}${contents.slice(signingConfigsBlock.end)}`;
}

function ensureReleaseBuildTypeUsesSigning(contents) {
  const buildTypesBlock = findNamedBlock(contents, 'buildTypes');
  if (!buildTypesBlock) return contents;

  const releaseBlock = findNamedBlock(contents, 'release', buildTypesBlock.openBraceIndex);
  if (!releaseBlock || releaseBlock.start > buildTypesBlock.end) return contents;

  const releaseText = contents.slice(releaseBlock.start, releaseBlock.end + 1);
  if (releaseText.includes('merakiUseReleaseSigning ? signingConfigs.release : signingConfigs.debug')) {
    return contents;
  }

  const updatedReleaseText = releaseText.replace(
    /signingConfig\s+signingConfigs\.debug/,
    `signingConfig merakiUseReleaseSigning ? signingConfigs.release : signingConfigs.debug
            if (!merakiUseReleaseSigning) {
                logger.warn('ADVERTENCIA: build de RELEASE firmado con la keystore de DEBUG. Define MERAKI_RELEASE_* en meraki-release.properties para firmar con tu llave propia.')
            }`
  );

  return `${contents.slice(0, releaseBlock.start)}${updatedReleaseText}${contents.slice(releaseBlock.end + 1)}`;
}

function setGradleProperty(properties, key, value) {
  const existing = properties.find((property) => property.type === 'property' && property.key === key);
  if (existing) {
    existing.value = value;
    return properties;
  }

  properties.push({ type: 'property', key, value });
  return properties;
}

const withMerakiReleaseSigning = (config) => {
  config = withGradleProperties(config, (configWithProperties) => {
    configWithProperties.modResults = setGradleProperty(configWithProperties.modResults, 'newArchEnabled', 'false');
    return configWithProperties;
  });

  return withAppBuildGradle(config, (configWithGradle) => {
    let contents = configWithGradle.modResults.contents;
    contents = ensureSigningHelper(contents);
    contents = ensureReleaseSigningConfig(contents);
    contents = ensureReleaseBuildTypeUsesSigning(contents);
    configWithGradle.modResults.contents = contents;
    return configWithGradle;
  });
};

module.exports = withMerakiReleaseSigning;
