// Sends the app's latest screens and text to phones that already have the APK (EAS Update), on the APK's channel.
// The server address is set here because an update does not read eas.json's build settings.
//   yarn update "What changed"            (the downloadable APK: channel preview)
//   yarn update "What changed" production
const { spawnSync } = require('node:child_process');
const eas = require('../eas.json');

const [message, profile = 'preview'] = process.argv.slice(2);
if (!message) {
  console.error('Say what changed, e.g. yarn update "New profile screen"');
  process.exit(1);
}
const build = eas.build[profile];
if (!build?.channel || !build.env?.EXPO_PUBLIC_API_URL) {
  console.error(`eas.json has no channel and EXPO_PUBLIC_API_URL for "${profile}"`);
  process.exit(1);
}
// Through the shell (npx needs it on Windows), so the message is quoted to stay one argument.
const args = ['eas-cli@latest', 'update', '--channel', build.channel, '--environment', profile, '--message', JSON.stringify(message)];
const result = spawnSync('npx', args, {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, EXPO_PUBLIC_API_URL: build.env.EXPO_PUBLIC_API_URL },
});
process.exit(result.status ?? 1);
