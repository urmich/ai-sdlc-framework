package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"
)

type fixtureFile struct {
	name string
	data []byte
	mode int64
	kind byte
}

type integrityFixture struct {
	root     string
	launcher string
	manifest payloadManifest
	platform platformMetadata
	files    []fixtureFile
}

func writeTestFile(t *testing.T, file string, data []byte, mode os.FileMode) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(file), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, data, mode); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(file, mode); err != nil {
		t.Fatal(err)
	}
}

func writeCanonicalFixture(t *testing.T, file string, value any) {
	t.Helper()
	data, err := canonicalJSON(value)
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, file, data, 0644)
}

func (f *integrityFixture) saveMetadata(t *testing.T) {
	t.Helper()
	writeCanonicalFixture(t, filepath.Join(f.root, "payload-manifest.json"), f.manifest)
	writeCanonicalFixture(t, filepath.Join(f.root, "platform.json"), f.platform)
}

func (f *integrityFixture) rebindInventory(t *testing.T) {
	t.Helper()
	data, err := canonicalJSON(f.manifest.Inventory)
	if err != nil {
		t.Fatal(err)
	}
	f.manifest.InventoryDigest = digest(data)
	f.platform.InventoryDigest = f.manifest.InventoryDigest
	f.saveMetadata(t)
}

func (f *integrityFixture) writePayload(t *testing.T) {
	t.Helper()
	var output bytes.Buffer
	gz := gzip.NewWriter(&output)
	writer := tar.NewWriter(gz)
	for _, file := range f.files {
		header := &tar.Header{Name: file.name, Size: int64(len(file.data)), Mode: file.mode, Format: tar.FormatUSTAR, Typeflag: file.kind}
		if file.kind == tar.TypeSymlink || file.kind == tar.TypeLink {
			header.Linkname = "../../outside"
			header.Size = 0
		}
		if err := writer.WriteHeader(header); err != nil {
			t.Fatal(err)
		}
		if header.Size > 0 {
			if _, err := writer.Write(file.data); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	f.manifest.Payload.SHA256 = digest(output.Bytes())
	f.platform.PayloadSHA256 = f.manifest.Payload.SHA256
	writeTestFile(t, filepath.Join(f.root, f.manifest.Payload.Filename), output.Bytes(), 0644)
	f.saveMetadata(t)
}

func newIntegrityFixture(t *testing.T) *integrityFixture {
	t.Helper()
	parent := filepath.Join("..", "..", ".test-data")
	if err := os.MkdirAll(parent, 0755); err != nil {
		t.Fatal(err)
	}
	root, err := os.MkdirTemp(parent, "winget integrity ")
	if err != nil {
		t.Fatal(err)
	}
	root, _ = filepath.Abs(root)
	t.Cleanup(func() { os.RemoveAll(root) })
	f := &integrityFixture{root: root, launcher: filepath.Join(root, "bin", "sdlc.exe")}
	writeTestFile(t, f.launcher, []byte("native launcher fixture"), 0644)
	f.files = []fixtureFile{
		{"package/LICENSE", []byte("MIT fixture license\n"), 0644, tar.TypeReg},
		{"package/bin/sdlc.mjs", []byte("console.log('verified CLI');\n"), 0755, tar.TypeReg},
		{"package/package.json", []byte(`{"name":"ai-sdlc-framework","version":"0.3.0","engines":{"node":">=22"}}`), 0644, tar.TypeReg},
		{"package/packaging/standalone/install.ps1", []byte("# installer\n"), 0644, tar.TypeReg},
		{"package/packaging/standalone/install.sh", []byte("#!/bin/sh\n"), 0644, tar.TypeReg},
		{"package/packaging/standalone/runtime.mjs", []byte("// must not execute during integrity verification\n"), 0644, tar.TypeReg},
		{"package/packaging/standalone/sdlc", []byte("#!/bin/sh\n"), 0644, tar.TypeReg},
		{"package/src/install.mjs", []byte("// fixture\n"), 0644, tar.TypeReg},
	}
	sort.Slice(f.files, func(i, j int) bool { return f.files[i].name < f.files[j].name })
	f.manifest = payloadManifest{SchemaVersion: 1, Name: "ai-sdlc-framework", Version: "0.3.0",
		Payload: payloadArtifact{Filename: "ai-sdlc-framework-0.3.0.tgz"}}
	for _, file := range f.files {
		writeTestFile(t, filepath.Join(root, filepath.FromSlash(file.name)), file.data, os.FileMode(file.mode))
		f.manifest.Inventory = append(f.manifest.Inventory, inventoryEntry{
			strings.TrimPrefix(file.name, "package/"), "file", int64(len(file.data)), digest(file.data), "0644",
		})
		if file.mode == 0755 {
			f.manifest.Inventory[len(f.manifest.Inventory)-1].Mode = "0755"
		}
	}
	f.platform = platformMetadata{SchemaVersion: 1, Name: f.manifest.Name, Version: f.manifest.Version,
		Platform: "win32", Arch: "x64", PayloadManifest: "payload-manifest.json",
		ChecksumReference: "SHA256SUMS", LauncherSHA256: digest([]byte("native launcher fixture"))}
	f.rebindInventory(t)
	f.writePayload(t)
	return f
}

func TestNativePayloadIntegrity(t *testing.T) {
	f := newIntegrityFixture(t)
	if err := verifyInstalledPayload(f.launcher, "win32", "x64"); err != nil {
		t.Fatal(err)
	}
	// WinGet's portable index belongs outside package/ and is not executable payload.
	writeTestFile(t, filepath.Join(f.root, "winget-owned-index"), []byte("manager data"), 0644)
	if err := verifyInstalledPayload(f.launcher, "win32", "x64"); err != nil {
		t.Fatal(err)
	}
}

func TestNativePayloadRejectsTampering(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*testing.T, *integrityFixture)
	}{
		{"missing payload manifest", func(t *testing.T, f *integrityFixture) { os.Remove(filepath.Join(f.root, "payload-manifest.json")) }},
		{"missing platform metadata", func(t *testing.T, f *integrityFixture) { os.Remove(filepath.Join(f.root, "platform.json")) }},
		{"malformed manifest", func(t *testing.T, f *integrityFixture) {
			writeTestFile(t, filepath.Join(f.root, "payload-manifest.json"), []byte("{"), 0644)
		}},
		{"noncanonical manifest", func(t *testing.T, f *integrityFixture) {
			data, _ := json.MarshalIndent(f.manifest, "", "  ")
			writeTestFile(t, filepath.Join(f.root, "payload-manifest.json"), data, 0644)
		}},
		{"duplicate metadata keys", func(t *testing.T, f *integrityFixture) {
			data, _ := canonicalJSON(f.manifest)
			data = append([]byte(`{"schemaVersion":1,`), data[1:]...)
			writeTestFile(t, filepath.Join(f.root, "payload-manifest.json"), data, 0644)
		}},
		{"unknown metadata field", func(t *testing.T, f *integrityFixture) {
			data, _ := canonicalJSON(f.manifest)
			data = append([]byte(`{"extra":true,`), data[1:]...)
			writeTestFile(t, filepath.Join(f.root, "payload-manifest.json"), data, 0644)
		}},
		{"wrong metadata version", func(t *testing.T, f *integrityFixture) { f.platform.Version = "0.2.0"; f.saveMetadata(t) }},
		{"wrong platform", func(t *testing.T, f *integrityFixture) { f.platform.Platform = "linux"; f.saveMetadata(t) }},
		{"wrong architecture", func(t *testing.T, f *integrityFixture) { f.platform.Arch = "arm64"; f.saveMetadata(t) }},
		{"wrong checksum reference", func(t *testing.T, f *integrityFixture) { f.platform.ChecksumReference = "other"; f.saveMetadata(t) }},
		{"missing launcher digest", func(t *testing.T, f *integrityFixture) { f.platform.LauncherSHA256 = ""; f.saveMetadata(t) }},
		{"launcher changed", func(t *testing.T, f *integrityFixture) { writeTestFile(t, f.launcher, []byte("modified"), 0644) }},
		{"missing embedded archive", func(t *testing.T, f *integrityFixture) { os.Remove(filepath.Join(f.root, f.manifest.Payload.Filename)) }},
		{"archive digest mismatch", func(t *testing.T, f *integrityFixture) {
			writeTestFile(t, filepath.Join(f.root, f.manifest.Payload.Filename), []byte("not gzip"), 0644)
		}},
		{"inventory digest mismatch", func(t *testing.T, f *integrityFixture) {
			f.manifest.InventoryDigest = strings.Repeat("0", 64)
			f.saveMetadata(t)
		}},
		{"duplicate inventory path", func(t *testing.T, f *integrityFixture) {
			f.manifest.Inventory = append(f.manifest.Inventory, f.manifest.Inventory[0])
			f.rebindInventory(t)
		}},
		{"case alias inventory path", func(t *testing.T, f *integrityFixture) {
			entry := f.manifest.Inventory[0]
			entry.Path = strings.ToLower(entry.Path)
			f.manifest.Inventory = append(f.manifest.Inventory, entry)
			sort.Slice(f.manifest.Inventory, func(i, j int) bool { return f.manifest.Inventory[i].Path < f.manifest.Inventory[j].Path })
			f.rebindInventory(t)
		}},
		{"unsafe inventory path", func(t *testing.T, f *integrityFixture) {
			f.manifest.Inventory[0].Path = "../escape"
			f.rebindInventory(t)
		}},
		{"wrong inventory type", func(t *testing.T, f *integrityFixture) {
			f.manifest.Inventory[0].Type = "symlink"
			f.rebindInventory(t)
		}},
		{"wrong inventory mode", func(t *testing.T, f *integrityFixture) { f.manifest.Inventory[0].Mode = "0600"; f.rebindInventory(t) }},
		{"wrong inventory size", func(t *testing.T, f *integrityFixture) { f.manifest.Inventory[0].Size++; f.rebindInventory(t) }},
		{"missing extracted file", func(t *testing.T, f *integrityFixture) {
			os.Remove(filepath.Join(f.root, "package", "src", "install.mjs"))
		}},
		{"extra extracted file", func(t *testing.T, f *integrityFixture) {
			writeTestFile(t, filepath.Join(f.root, "package", "extra.mjs"), nil, 0644)
		}},
		{"extra empty directory", func(t *testing.T, f *integrityFixture) { os.Mkdir(filepath.Join(f.root, "package", "extra"), 0755) }},
		{"file changed to directory", func(t *testing.T, f *integrityFixture) {
			file := filepath.Join(f.root, "package", "src", "install.mjs")
			os.Remove(file)
			os.Mkdir(file, 0755)
		}},
		{"extracted size changed", func(t *testing.T, f *integrityFixture) {
			writeTestFile(t, filepath.Join(f.root, "package", "bin", "sdlc.mjs"), []byte("changed"), 0755)
		}},
		{"extracted same-size content changed", func(t *testing.T, f *integrityFixture) {
			file := filepath.Join(f.root, "package", "bin", "sdlc.mjs")
			data, _ := os.ReadFile(file)
			data[0] ^= 1
			writeTestFile(t, file, data, 0755)
		}},
		{"tampered inventory cannot launder changed JS", func(t *testing.T, f *integrityFixture) {
			data := []byte("console.log('unverified');")
			writeTestFile(t, filepath.Join(f.root, "package", "bin", "sdlc.mjs"), data, 0755)
			for index := range f.manifest.Inventory {
				if f.manifest.Inventory[index].Path == "bin/sdlc.mjs" {
					f.manifest.Inventory[index].Size = int64(len(data))
					f.manifest.Inventory[index].SHA256 = digest(data)
				}
			}
			f.rebindInventory(t)
		}},
		{"duplicate tar entry", func(t *testing.T, f *integrityFixture) { f.files = append(f.files, f.files[0]); f.writePayload(t) }},
		{"extra tar entry", func(t *testing.T, f *integrityFixture) {
			f.files = append(f.files, fixtureFile{"package/extra", nil, 0644, tar.TypeReg})
			f.writePayload(t)
		}},
		{"unsafe tar entry", func(t *testing.T, f *integrityFixture) { f.files[0].name = "../escape"; f.writePayload(t) }},
		{"symlink tar entry", func(t *testing.T, f *integrityFixture) { f.files[0].kind = tar.TypeSymlink; f.writePayload(t) }},
		{"hardlink tar entry", func(t *testing.T, f *integrityFixture) { f.files[0].kind = tar.TypeLink; f.writePayload(t) }},
		{"directory tar entry", func(t *testing.T, f *integrityFixture) {
			f.files[0].kind = tar.TypeDir
			f.files[0].data = nil
			f.writePayload(t)
		}},
		{"wrong tar mode", func(t *testing.T, f *integrityFixture) { f.files[0].mode = 0600; f.writePayload(t) }},
		{"truncated archive even with updated checksum", func(t *testing.T, f *integrityFixture) {
			file := filepath.Join(f.root, f.manifest.Payload.Filename)
			data, _ := os.ReadFile(file)
			data = data[:len(data)-4]
			writeTestFile(t, file, data, 0644)
			f.manifest.Payload.SHA256 = digest(data)
			f.platform.PayloadSHA256 = f.manifest.Payload.SHA256
			f.saveMetadata(t)
		}},
		{"trailing archive bytes even with updated checksum", func(t *testing.T, f *integrityFixture) {
			file := filepath.Join(f.root, f.manifest.Payload.Filename)
			data, _ := os.ReadFile(file)
			data = append(data, []byte("trailing content")...)
			writeTestFile(t, file, data, 0644)
			f.manifest.Payload.SHA256 = digest(data)
			f.platform.PayloadSHA256 = f.manifest.Payload.SHA256
			f.saveMetadata(t)
		}},
		{"extracted mode changed", func(t *testing.T, f *integrityFixture) {
			if runtime.GOOS == "windows" {
				t.Skip("Windows mode identity comes from verified tar metadata")
			}
			os.Chmod(filepath.Join(f.root, "package", "bin", "sdlc.mjs"), 0644)
		}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			f := newIntegrityFixture(t)
			test.mutate(t, f)
			if err := verifyInstalledPayload(f.launcher, "win32", "x64"); err == nil {
				t.Fatal("tampered distribution accepted")
			}
		})
	}
}

func TestInventoryRejectsWindowsAliasesAndInvalidModes(t *testing.T) {
	for _, name := range []string{"", "/absolute", "../parent", "a/../b", "a//b", "a\\b",
		"CON", "con.txt", "AUX.txt", "a/NUL.txt", "COM1.js", "lpt9", "trailing.", "alternate:stream", "non-ascii-\u03bb"} {
		t.Run(name, func(t *testing.T) {
			entry := inventoryEntry{name, "file", 0, strings.Repeat("0", 64), "0644"}
			if validateInventory([]inventoryEntry{entry}) == nil {
				t.Fatal("unsafe path accepted")
			}
		})
	}
	for _, mode := range []string{"644", "0777", "4755", "", "invalid"} {
		entry := inventoryEntry{"file", "file", 0, strings.Repeat("0", 64), mode}
		if validateInventory([]inventoryEntry{entry}) == nil {
			t.Fatalf("invalid mode %q accepted", mode)
		}
	}
}

func TestNativePayloadRejectsFilesystemLinks(t *testing.T) {
	for _, relative := range []string{"payload-manifest.json", "platform.json", "ai-sdlc-framework-0.3.0.tgz",
		"package/bin/sdlc.mjs", "package/src"} {
		t.Run(relative, func(t *testing.T) {
			f := newIntegrityFixture(t)
			original := filepath.Join(f.root, filepath.FromSlash(relative))
			target := filepath.Join(f.root, "outside-copy")
			if err := os.Rename(original, target); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(target, original); err != nil {
				t.Skipf("host cannot create link fixture: %v", err)
			}
			if err := verifyInstalledPayload(f.launcher, "win32", "x64"); err == nil {
				t.Fatal("linked payload accepted")
			}
		})
	}
}

func TestSharedCanonicalArchiveContract(t *testing.T) {
	root := os.Getenv("SDLC_VERIFY_SHARED_ROOT")
	if root == "" {
		t.Skip("set SDLC_VERIFY_SHARED_ROOT to an independently extracted shared Windows archive")
	}
	if err := verifyInstalledPayload(filepath.Join(root, "bin", "sdlc.exe"), "win32", "x64"); err != nil {
		t.Fatal(err)
	}
}
