/**
 * Babel plugin: drops console.log / console.debug / console.info calls from production
 * bundles (release builds, EAS Update). They cost a bridge/JSI call and string building on
 * every hot path (147 of them: WS events, renders, fetches) for output nobody reads.
 * console.warn / console.error stay (Sentry breadcrumbs). Development is untouched.
 */
const DROP = new Set(['log', 'debug', 'info']);

module.exports = function stripConsole() {
  return {
    name: 'strip-console',
    visitor: {
      CallExpression(path) {
        const callee = path.get('callee');
        if (!callee.isMemberExpression()) return;
        const obj = callee.get('object');
        const prop = callee.node.property;
        if (!obj.isIdentifier({ name: 'console' }) || !prop || prop.type !== 'Identifier' || !DROP.has(prop.name)) return;
        // As a statement: removed; inside an expression: replaced by undefined.
        if (path.parentPath.isExpressionStatement()) path.parentPath.remove();
        else path.replaceWith({ type: 'Identifier', name: 'undefined' });
      },
    },
  };
};
