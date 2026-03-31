const { expo } = require("./app.json");

module.exports = () => ({
  ...expo,
  extra: {
    ...(expo.extra ?? {}),
    eas: {
      ...(expo.extra?.eas ?? {}),
      projectId: process.env.EXPO_PROJECT_ID ?? expo.extra?.eas?.projectId,
    },
  },
});
