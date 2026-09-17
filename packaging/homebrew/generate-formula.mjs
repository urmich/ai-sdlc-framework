import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const NAME = 'ai-sdlc-framework';
const REPOSITORY = 'https://github.com/urmich/ai-sdlc-framework';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/u;

function validateDescriptor(descriptor) {
  if (descriptor?.schemaVersion !== 1 || descriptor.name !== NAME ||
      !semver.test(descriptor.version) ||
      !/^[a-f0-9]{40}$/u.test(descriptor.sourceCommit) ||
      descriptor.payload?.filename !== `${NAME}-${descriptor.version}.tgz` ||
      !/^[a-f0-9]{64}$/u.test(descriptor.payload?.sha256) ||
      !/^[a-f0-9]{64}$/u.test(descriptor.payload?.inventoryDigest) ||
      !Array.isArray(descriptor.files)) {
    throw new Error('Invalid versioned release descriptor');
  }
  const names = new Set();
  for (const file of descriptor.files) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(file.filename) ||
        names.has(file.filename) || !/^[a-f0-9]{64}$/u.test(file.sha256) ||
        !Number.isSafeInteger(file.size) || file.size <= 0 ||
        !['archive', 'homebrew', 'winget', 'metadata'].includes(file.kind)) {
      throw new Error('Invalid or duplicate release descriptor file');
    }
    names.add(file.filename);
  }
}

/** Accepts the archive-stage descriptor subset; the final descriptor adds this formula. */
export async function generateHomebrewFormula({
  descriptor, artifactDirectory, mode = 'stable', candidateBaseUrl, architectures = ['arm64'],
} = {}) {
  validateDescriptor(descriptor);
  if (!['stable', 'candidate'].includes(mode)) throw new Error('Unknown Homebrew metadata mode');
  if (!Array.isArray(architectures) || !architectures.length ||
      new Set(architectures).size !== architectures.length ||
      architectures.some(arch => !['arm64', 'x64'].includes(arch))) {
    throw new Error('Select unique supported Homebrew candidate architectures');
  }
  if (mode === 'stable' && (architectures.length !== 1 || architectures[0] !== 'arm64')) {
    throw new Error('Stable Homebrew output is arm64-only until native Intel acceptance');
  }
  const selected = ['arm64', 'x64'].filter(arch => architectures.includes(arch));
  if (mode === 'stable' && descriptor.version.includes('-')) {
    throw new Error('Prereleases must not generate stable Homebrew metadata');
  }
  if (!artifactDirectory) throw new Error('An artifact directory is required to verify checksums');
  let base = `${REPOSITORY}/releases/download/v${descriptor.version}/`;
  if (mode === 'candidate') {
    const url = new URL(candidateBaseUrl);
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
        !url.port || url.username || url.password || url.search || url.hash ||
        !/^\/[a-zA-Z0-9/_-]*$/u.test(url.pathname) || !url.pathname.endsWith('/')) {
      throw new Error('Candidate URLs must use an explicit loopback HTTP fixture with a trailing slash');
    }
    base = url.href;
  } else if (candidateBaseUrl !== undefined) {
    throw new Error('Stable metadata cannot contain a candidate URL');
  }
  const archives = {};
  for (const arch of selected) {
    const filename = `${NAME}-${descriptor.version}-macos-${arch}.tar.gz`;
    const record = descriptor.files.find(file => file.filename === filename);
    if (record?.kind !== 'archive') throw new Error(`Missing macOS ${arch} archive: ${filename}`);
    const file = path.join(artifactDirectory, filename);
    if (!(await fs.lstat(file)).isFile()) throw new Error(`Archive must be a regular file: ${filename}`);
    const bytes = await fs.readFile(file);
    if (bytes.length !== record.size || digest(bytes) !== record.sha256) {
      throw new Error(`Archive checksum or size mismatch: ${filename}`);
    }
    archives[arch] = { ...record, url: `${base}${filename}` };
  }
  const sourceLines = (arch, indent) => `${indent}url "${archives[arch].url}"
${mode === 'candidate' ? `${indent}version "${descriptor.version}" if version.to_s != "${descriptor.version}"\n` : ''}${indent}sha256 "${archives[arch].sha256}"
`;
  const single = selected.length === 1;
  const conditionalSources = single ? '' : `  on_macos do
${selected.map(arch => `    ${arch === 'arm64' ? 'on_arm' : 'on_intel'} do
${sourceLines(arch, '      ')}    end
`).join('')}  end

`;
  const contents = `${mode === 'candidate' ? '# Test-only local candidate; never publish to the stable tap.\n' : ''}class AiSdlcFramework < Formula
  desc "Offline, receipt-bound SDLC workflow for GitHub Copilot CLI"
  homepage "${REPOSITORY}"
${single ? sourceLines(selected[0], '  ') : ''}  license "MIT"

${single ? `  depends_on arch: :${selected[0] === 'arm64' ? 'arm64' : 'x86_64'}\n` : ''}  depends_on :macos
  depends_on "node@22"

${conditionalSources}  # The embedded payload manifest binds these bytes, including Node shebangs.
  skip_clean "libexec"

  def install
    libexec.install Dir["*"]
    cp libexec/"LICENSE", prefix/"LICENSE"
    (bin/"sdlc").write_env_script libexec/"bin/sdlc",
                                PATH:      "\#{formula_opt_bin("node@22")}:$PATH",
                                SDLC_NODE: "\#{formula_opt_bin("node@22")}/node"
  end

  def caveats
    <<~EOS
      Homebrew owns only its Cellar payload and launcher, not COPILOT_HOME.
      Close Copilot, then run sdlc install (or sdlc install --purge-existing).
      Restart Copilot after installation or update.
      brew upgrade replaces only the package; run sdlc update explicitly.
      brew uninstall leaves the explicit Copilot-home installation intact.
      To remove that installation, run sdlc uninstall before removing the package.
      sdlc uninstall --purge explicitly removes framework runtime state.
    EOS
  end

  test do
    ENV["COPILOT_HOME"] = testpath/"copilot home"
    system bin/"sdlc", "install"
    result = JSON.parse(shell_output("#{bin}/sdlc doctor"))
    assert_equal true, result["installed"]
    assert_equal version.to_s, result["frameworkVersion"]
    assert_empty result["findings"]
    system bin/"sdlc", "update"
    system bin/"sdlc", "uninstall"
    result = JSON.parse(shell_output("#{bin}/sdlc doctor"))
    assert_equal false, result["installed"]
  end
end
`;
  return { filename: `${NAME}.rb`, kind: 'homebrew', contents,
    sha256: digest(contents), size: Buffer.byteLength(contents), mode };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [descriptorFile, artifactDirectory, outputFile, candidateBaseUrl] = process.argv.slice(2);
  if (!descriptorFile || !artifactDirectory || !outputFile || process.argv.length > 6) {
    throw new Error('Usage: node packaging/homebrew/generate-formula.mjs DESCRIPTOR ARTIFACT_DIR OUTPUT.rb [LOOPBACK_URL]');
  }
  const descriptor = JSON.parse(await fs.readFile(descriptorFile, 'utf8'));
  const formula = await generateHomebrewFormula({ descriptor, artifactDirectory, candidateBaseUrl,
    mode: candidateBaseUrl ? 'candidate' : 'stable' });
  await fs.mkdir(path.dirname(path.resolve(outputFile)), { recursive: true });
  await fs.writeFile(outputFile, formula.contents);
  const { contents, ...metadata } = formula;
  process.stdout.write(`${JSON.stringify(metadata)}\n`);
}
