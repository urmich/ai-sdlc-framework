package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"unicode/utf8"
)

const maxArchiveSize = 128 * 1024 * 1024
const maxInventoryEntries = 20000

var digestPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var archivePathPattern = regexp.MustCompile(`^[a-zA-Z0-9_./+-]+$`)
var reservedPathPart = regexp.MustCompile(`(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)`)
var packageVersionPattern = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$`)

type inventoryEntry struct {
	Path   string `json:"path"`
	Type   string `json:"type"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
	Mode   string `json:"mode"`
}

type payloadArtifact struct {
	Filename string `json:"filename"`
	SHA256   string `json:"sha256"`
}

type payloadManifest struct {
	SchemaVersion   int              `json:"schemaVersion"`
	Name            string           `json:"name"`
	Version         string           `json:"version"`
	Payload         payloadArtifact  `json:"payload"`
	InventoryDigest string           `json:"inventoryDigest"`
	Inventory       []inventoryEntry `json:"inventory"`
}

type platformMetadata struct {
	SchemaVersion     int    `json:"schemaVersion"`
	Name              string `json:"name"`
	Version           string `json:"version"`
	Platform          string `json:"platform"`
	Arch              string `json:"arch"`
	PayloadSHA256     string `json:"payloadSha256"`
	InventoryDigest   string `json:"inventoryDigest"`
	PayloadManifest   string `json:"payloadManifest"`
	ChecksumReference string `json:"checksumReference"`
	LauncherSHA256    string `json:"launcherSha256"`
}

func digest(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func canonicalJSON(value any) ([]byte, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var object any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&object); err != nil {
		return nil, err
	}
	var result bytes.Buffer
	encoder := json.NewEncoder(&result)
	encoder.SetEscapeHTML(false)
	// encoding/json sorts map keys; Encode adds the protocol's single LF.
	if err := encoder.Encode(object); err != nil {
		return nil, err
	}
	return result.Bytes(), nil
}

func readRegular(file string, limit int64) ([]byte, error) {
	info, err := os.Lstat(file)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > limit {
		return nil, fmt.Errorf("not a bounded regular file: %s", file)
	}
	handle, err := os.Open(file)
	if err != nil {
		return nil, err
	}
	defer handle.Close()
	opened, err := handle.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return nil, fmt.Errorf("file changed during verification: %s", file)
	}
	data, err := io.ReadAll(io.LimitReader(handle, limit+1))
	if err != nil {
		return nil, err
	}
	current, err := os.Lstat(file)
	if err != nil || !current.Mode().IsRegular() || !os.SameFile(info, current) ||
		int64(len(data)) != info.Size() || int64(len(data)) > limit {
		return nil, fmt.Errorf("file changed or exceeds size limit: %s", file)
	}
	return data, nil
}

func readCanonical(file string, value any) error {
	data, err := readRegular(file, 16*1024*1024)
	if err != nil {
		return err
	}
	if !utf8.Valid(data) {
		return fmt.Errorf("metadata is not UTF-8: %s", file)
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return fmt.Errorf("invalid metadata %s: %w", file, err)
	}
	expected, err := canonicalJSON(value)
	if err != nil || !bytes.Equal(data, expected) {
		return fmt.Errorf("noncanonical, duplicate, or missing metadata fields: %s", file)
	}
	return nil
}

func safeArchivePath(name string) bool {
	if !archivePathPattern.MatchString(name) {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if part == "" || part == "." || part == ".." || strings.HasSuffix(part, ".") || reservedPathPart.MatchString(part) {
			return false
		}
	}
	return true
}

func validateInventory(inventory []inventoryEntry) error {
	if len(inventory) == 0 || len(inventory) > maxInventoryEntries {
		return errors.New("invalid payload inventory count")
	}
	seen := make(map[string]bool, len(inventory))
	var total int64
	for index, entry := range inventory {
		key := strings.ToLower(entry.Path)
		if !safeArchivePath(entry.Path) || seen[key] ||
			index > 0 && inventory[index-1].Path >= entry.Path ||
			entry.Type != "file" || entry.Size < 0 || entry.Size > maxArchiveSize ||
			!digestPattern.MatchString(entry.SHA256) || entry.Mode != "0644" && entry.Mode != "0755" {
			return fmt.Errorf("unsafe, duplicate, unsorted, or malformed inventory entry: %s", entry.Path)
		}
		total += entry.Size
		if total > maxArchiveSize {
			return errors.New("payload inventory exceeds size limit")
		}
		seen[key] = true
	}
	for name := range seen {
		for parent := path.Dir(name); parent != "."; parent = path.Dir(parent) {
			if seen[parent] {
				return errors.New("payload inventory contains a file/directory collision")
			}
		}
	}
	return nil
}

func allZero(data []byte) bool {
	for _, value := range data {
		if value != 0 {
			return false
		}
	}
	return true
}

func payloadInventory(archive []byte, name, version string) ([]inventoryEntry, error) {
	compressed := bytes.NewReader(archive)
	reader, err := gzip.NewReader(compressed)
	if err != nil {
		return nil, err
	}
	reader.Multistream(false)
	unpacked, err := io.ReadAll(io.LimitReader(reader, maxArchiveSize+1))
	closeErr := reader.Close()
	if err != nil || closeErr != nil || len(unpacked) > maxArchiveSize || compressed.Len() != 0 || len(unpacked)%512 != 0 {
		return nil, errors.New("invalid, truncated, or oversized embedded gzip archive")
	}
	source := bytes.NewReader(unpacked)
	tarReader := tar.NewReader(source)
	var inventory []inventoryEntry
	var packageJSON []byte
	offset := 0
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			if len(unpacked)-offset < 1024 || !allZero(unpacked[offset:]) {
				return nil, errors.New("missing tar terminator or trailing payload entries")
			}
			break
		}
		if err != nil {
			return nil, err
		}
		if header.Format != tar.FormatUSTAR || header.Typeflag != tar.TypeReg ||
			header.Linkname != "" || !strings.HasPrefix(header.Name, "package/") ||
			!safeArchivePath(header.Name) || header.Size < 0 || header.Size > maxArchiveSize ||
			header.Mode != 0o644 && header.Mode != 0o755 ||
			len(unpacked)-source.Len() != offset+512 || len(inventory) >= maxInventoryEntries {
			return nil, errors.New("unsupported payload archive path, type, mode, or header")
		}
		data, err := io.ReadAll(tarReader)
		if err != nil || int64(len(data)) != header.Size {
			return nil, errors.New("truncated payload file")
		}
		end := offset + 512 + len(data)
		next := offset + 512 + (len(data)+511)/512*512
		if next > len(unpacked) || !allZero(unpacked[end:next]) {
			return nil, errors.New("malformed tar padding")
		}
		offset = next
		relative := strings.TrimPrefix(header.Name, "package/")
		inventory = append(inventory, inventoryEntry{relative, "file", header.Size, digest(data), fmt.Sprintf("%04o", header.Mode)})
		if relative == "package.json" {
			packageJSON = data
		}
	}
	sort.Slice(inventory, func(left, right int) bool { return inventory[left].Path < inventory[right].Path })
	if err := validateInventory(inventory); err != nil {
		return nil, err
	}
	var pkg struct {
		Name         string                     `json:"name"`
		Version      string                     `json:"version"`
		Engines      map[string]string          `json:"engines"`
		Dependencies map[string]json.RawMessage `json:"dependencies"`
	}
	if !utf8.Valid(packageJSON) || json.Unmarshal(packageJSON, &pkg) != nil ||
		pkg.Name != name || pkg.Version != version || pkg.Engines["node"] != ">=22" || len(pkg.Dependencies) != 0 {
		return nil, errors.New("embedded package identity or runtime requirements do not match")
	}
	paths := make(map[string]bool, len(inventory))
	for _, entry := range inventory {
		paths[entry.Path] = true
	}
	for _, required := range []string{"LICENSE", "bin/sdlc.mjs", "src/install.mjs",
		"packaging/standalone/runtime.mjs", "packaging/standalone/install.sh",
		"packaging/standalone/install.ps1", "packaging/standalone/sdlc"} {
		if !paths[required] {
			return nil, fmt.Errorf("embedded payload is missing %s", required)
		}
	}
	return inventory, nil
}

func verifyPackageTree(root string, inventory []inventoryEntry) error {
	expected := make(map[string]inventoryEntry, len(inventory))
	directories := map[string]bool{".": true}
	for _, entry := range inventory {
		expected[entry.Path] = entry
		for parent := path.Dir(entry.Path); parent != "."; parent = path.Dir(parent) {
			directories[parent] = true
		}
	}
	seen := make(map[string]bool, len(inventory))
	err := filepath.WalkDir(root, func(file string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(root, file)
		if err != nil {
			return err
		}
		relative = filepath.ToSlash(relative)
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("linked package entry: %s", relative)
		}
		if entry.IsDir() {
			if !directories[relative] {
				return fmt.Errorf("unlisted package directory: %s", relative)
			}
			return nil
		}
		record, exists := expected[relative]
		if !exists || seen[relative] || !entry.Type().IsRegular() {
			return fmt.Errorf("unlisted, linked, or non-regular package entry: %s", relative)
		}
		info, err := entry.Info()
		if err != nil || info.Size() != record.Size {
			return fmt.Errorf("package file size mismatch: %s", relative)
		}
		// Windows does not retain POSIX mode bits: the verified tar is authoritative.
		if runtime.GOOS != "windows" && (fmt.Sprintf("%04o", info.Mode().Perm()) != record.Mode ||
			info.Mode()&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0) {
			return fmt.Errorf("package file mode mismatch: %s", relative)
		}
		data, err := readRegular(file, record.Size)
		if err != nil {
			return err
		}
		if digest(data) != record.SHA256 {
			return fmt.Errorf("package file SHA-256 mismatch: %s", relative)
		}
		seen[relative] = true
		return nil
	})
	if err != nil {
		return err
	}
	if len(seen) != len(expected) {
		return errors.New("package inventory has missing files")
	}
	return nil
}

func verifyInstalledPayload(executable, platform, arch string) error {
	resolved, err := filepath.EvalSymlinks(executable)
	if err != nil {
		return err
	}
	root, err := filepath.Abs(filepath.Join(filepath.Dir(resolved), ".."))
	if err != nil {
		return err
	}
	var manifest payloadManifest
	if err := readCanonical(filepath.Join(root, "payload-manifest.json"), &manifest); err != nil {
		return err
	}
	if manifest.SchemaVersion != 1 || manifest.Name != "ai-sdlc-framework" ||
		!packageVersionPattern.MatchString(manifest.Version) ||
		manifest.Payload.Filename != manifest.Name+"-"+manifest.Version+".tgz" ||
		!digestPattern.MatchString(manifest.Payload.SHA256) || !digestPattern.MatchString(manifest.InventoryDigest) {
		return errors.New("invalid embedded payload manifest identity")
	}
	if err := validateInventory(manifest.Inventory); err != nil {
		return err
	}
	declared, err := canonicalJSON(manifest.Inventory)
	if err != nil || digest(declared) != manifest.InventoryDigest {
		return errors.New("payload inventory digest mismatch")
	}
	var metadata platformMetadata
	if err := readCanonical(filepath.Join(root, "platform.json"), &metadata); err != nil {
		return err
	}
	if metadata.SchemaVersion != 1 || metadata.Name != manifest.Name || metadata.Version != manifest.Version ||
		metadata.Platform != platform || metadata.Arch != arch ||
		metadata.PayloadSHA256 != manifest.Payload.SHA256 || metadata.InventoryDigest != manifest.InventoryDigest ||
		metadata.PayloadManifest != "payload-manifest.json" || metadata.ChecksumReference != "SHA256SUMS" ||
		!digestPattern.MatchString(metadata.LauncherSHA256) {
		return errors.New("embedded platform metadata does not match the payload or native runtime")
	}
	launcher, err := readRegular(filepath.Join(root, "bin", "sdlc.exe"), maxArchiveSize)
	if err != nil || digest(launcher) != metadata.LauncherSHA256 {
		return errors.New("installed launcher digest mismatch")
	}
	archive, err := readRegular(filepath.Join(root, manifest.Payload.Filename), maxArchiveSize)
	if err != nil {
		return err
	}
	if digest(archive) != manifest.Payload.SHA256 {
		return errors.New("embedded payload archive digest mismatch")
	}
	inventory, err := payloadInventory(archive, manifest.Name, manifest.Version)
	if err != nil {
		return err
	}
	actual, err := canonicalJSON(inventory)
	if err != nil || !bytes.Equal(actual, declared) {
		return errors.New("declared inventory does not match the embedded payload archive")
	}
	return verifyPackageTree(filepath.Join(root, "package"), inventory)
}
