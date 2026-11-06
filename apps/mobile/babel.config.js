module.exports = function (api) {
  // Production bundles (release, EAS Update) drop console.log / debug / info (plugins/babel-strip-console.js).
  // Metro tells Babel whether it's a dev bundle (caller.isDev); outside Metro, BABEL_ENV / NODE_ENV.
  const production = api.caller(c => (c && typeof c.isDev === 'boolean' ? !c.isDev : null)) ?? api.env('production');
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ...(production ? ['./plugins/babel-strip-console.js'] : []),
      // Support @/* path aliases defined in tsconfig.json
      [
        'module-resolver',
        {
          root: ['.'],
          alias: {
            '@': './src',
          },
          extensions: ['.ts', '.tsx', '.js', '.jsx'],
        },
      ],
    ],
  };
};
