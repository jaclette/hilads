// Extends app.json (the source of truth) with config plugins added in code.
module.exports = ({ config }) => ({
  ...config,
  plugins: [...(config.plugins ?? []), './plugins/withMapsAppQueries'],
});
