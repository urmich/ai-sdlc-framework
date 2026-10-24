export const nativeToolchain = Object.freeze({
  node: '24.20.0', go: 'go1.27.1', python: '3.12.10',
});

export const nativeSdkBootstrapProtocol = 'native-bootstrap-role-capabilities-v3';
export const nativeUnitBootstrapProtocol = 'native-bootstrap-role-capabilities-v4';
export const nativeBodyBootstrapProtocol = 'native-bootstrap-role-capabilities-v5';
export const nativeBootstrapProtocol = 'native-bootstrap-role-capabilities-v6';
export const nativeBootstrapProtocols = Object.freeze([
  'native-bootstrap-role-capabilities-v2', nativeSdkBootstrapProtocol, nativeUnitBootstrapProtocol,
  nativeBodyBootstrapProtocol, nativeBootstrapProtocol,
]);

export const homebrewToolchain = Object.freeze({
  commit: '99fd9a8eed4ff942c448da0c1f11156302441e4a',
  ruby: '4.0.7',
  coreCommit: '0bae42d6d1e59c2c400da252bd64e585e3fe7d58',
  formula: 'node@24',
  major: 24,
  node: nativeToolchain.node,
});
