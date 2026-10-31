/**
 * Config plugin: raise every pod target's IPHONEOS_DEPLOYMENT_TARGET to the
 * app's minimum (15.1, the Podfile's platform).
 *
 * Why:
 *   Xcode 27 only accepts deployment targets from 15.0 and fails the build
 *   (an error, not a warning) on pods that still declare older ones:
 *   MapboxMaps resources 14.0, Sentry 11.0, SDWebImage 9.0,
 *   ReachabilitySwift 12.0, RNCAsyncStorage resources 9.0, RNSVG 12.4.
 *   The app never runs below 15.1 anyway, so lifting them changes nothing
 *   at runtime.
 *
 * Also patches fmt 11.0.2 (React Native's C++ formatting library): Xcode 27's
 * clang rejects its compile-time format checks ("call to consteval function
 * 'fmt::basic_format_string<...>' is not a constant expression"), and fmt has
 * no switch for them. Pods/fmt/include/fmt/base.h gets one line so Apple clang
 * takes fmt's non-consteval path (what it already does before clang 14):
 * formatting is the same, only the compile-time check of format strings goes.
 * Every target including fmt (fmt, Folly, React) sees the same header.
 *
 * Adds a step to the Podfile's post_install, after react_native_post_install
 * (pods project targets, resource bundles included). Survives every `npx expo prebuild --clean`
 * because it re-runs as part of the plugins pipeline.
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

const MARK = '# hilads: pods deployment target';

module.exports = function withPodsDeploymentTarget(config, props = {}) {
  const target = props.deploymentTarget || '15.1';
  return withDangerousMod(config, ['ios', (cfg) => {
    const file = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
    let podfile = fs.readFileSync(file, 'utf8');
    if (podfile.includes(MARK)) return cfg;
    const step = [
      `    ${MARK}`,
      '    installer.pods_project.targets.each do |t|',
      '      t.build_configurations.each do |c|',
      `        if c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < ${target}`,
      `          c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${target}'`,
      '        end',
      '      end',
      '    end',
      '',
      '    # hilads: fmt consteval off on Apple clang (Xcode 27)',
      "    fmt_base = File.join(installer.sandbox.root.to_s, 'fmt', 'include', 'fmt', 'base.h')",
      '    if File.exist?(fmt_base)',
      '      src = File.read(fmt_base)',
      "      unless src.include?('hilads: Xcode 27')",
      "        patched = src.sub(\"#elif defined(__cpp_consteval)\\n\", \"#elif defined(__apple_build_version__)\\n#  define FMT_USE_CONSTEVAL 0  // hilads: Xcode 27 clang rejects fmt 11.0 consteval checks\\n#elif defined(__cpp_consteval)\\n\")",
      '        if patched != src',
      '          File.chmod(0644, fmt_base)',
      '          File.write(fmt_base, patched)',
      '        end',
      '      end',
      '    end',
    ].join('\n');
    // After react_native_post_install (it touches build settings too): before the
    // template's resource-bundle signing step, else at the top of post_install.
    const anchor = '    # This is necessary for Xcode 14';
    if (podfile.includes(anchor)) {
      podfile = podfile.replace(anchor, `${step}\n\n${anchor}`);
    } else if (/post_install do \|installer\|/.test(podfile)) {
      podfile = podfile.replace(/post_install do \|installer\|/, (m) => `${m}\n${step}`);
    } else {
      throw new Error('withPodsDeploymentTarget: no post_install block in the Podfile');
    }
    fs.writeFileSync(file, podfile);
    return cfg;
  }]);
};
