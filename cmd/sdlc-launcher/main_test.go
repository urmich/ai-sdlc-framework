package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

func TestMain(m *testing.M) {
	if mode := os.Getenv("SDLC_TEST_NODE_PROBE"); mode != "" && len(os.Args) > 1 && os.Args[1] == "--eval" {
		if mode == "crash" {
			os.Exit(17)
		}
		if mode == "malformed" {
			fmt.Print("not JSON")
			os.Exit(0)
		}
		executable, _ := os.Executable()
		executable, _ = filepath.EvalSymlinks(executable)
		info := nodeInfo{"22.1.0", "win32", "x64", executable}
		switch mode {
		case "old":
			info.Version = "21.0.0"
		case "wrong-arch":
			info.Arch = "arm64"
		case "shadowed":
			info.ExecPath = filepath.Dir(executable)
		}
		json.NewEncoder(os.Stdout).Encode(info)
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func TestFindNodeValidatesTheSelectedExecutable(t *testing.T) {
	parent := filepath.Join("..", "..", ".test-data")
	if err := os.MkdirAll(parent, 0755); err != nil {
		t.Fatal(err)
	}
	directory, err := os.MkdirTemp(parent, "winget node with spaces ")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(directory) })
	directory, _ = filepath.Abs(directory)
	executable, _ := os.Executable()
	bytes, err := os.ReadFile(executable)
	if err != nil {
		t.Fatal(err)
	}
	selected := filepath.Join(directory, "node.exe")
	if err := os.WriteFile(selected, bytes, 0755); err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if err := os.Symlink(selected, filepath.Join(directory, "node")); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", directory)
	t.Setenv("PATHEXT", ".EXE;.CMD")
	for _, mode := range []string{"valid", "old", "wrong-arch", "shadowed", "crash", "malformed"} {
		t.Run(mode, func(t *testing.T) {
			t.Setenv("SDLC_TEST_NODE_PROBE", mode)
			got, err := findNode(runtimeEnvironment(os.Environ()), "win32", "x64")
			if mode == "valid" {
				if err != nil || !filepath.IsAbs(got) {
					t.Fatalf("selected = %q, %v", got, err)
				}
			} else if err == nil {
				t.Fatalf("accepted %s probe", mode)
			}
		})
	}
	t.Run("relative PATH is rejected even when Go ErrDot is disabled", func(t *testing.T) {
		t.Chdir(directory)
		t.Setenv("PATH", ".")
		t.Setenv("GODEBUG", "execerrdot=0")
		t.Setenv("SDLC_TEST_NODE_PROBE", "valid")
		if _, err := findNode(runtimeEnvironment(os.Environ()), "win32", "x64"); err == nil {
			t.Fatal("current-directory Node accepted")
		}
	})
	if err := os.Remove(selected); err != nil {
		t.Fatal(err)
	}
	if _, err := findNode(runtimeEnvironment(os.Environ()), "win32", "x64"); err == nil {
		t.Fatal("missing Node accepted")
	}
	if runtime.GOOS != "windows" {
		if err := os.WriteFile(selected, bytes, 0644); err != nil {
			t.Fatal(err)
		}
		if _, err := findNode(runtimeEnvironment(os.Environ()), "win32", "x64"); err == nil {
			t.Fatal("non-executable Node accepted")
		}
	}
}

func TestRuntimeValidation(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name     string
		version  string
		platform string
		arch     string
		execPath string
		valid    bool
	}{
		{"minimum", "22.0.0", "win32", "x64", executable, true},
		{"newer", "26.1.2", "win32", "x64", executable, true},
		{"old", "21.9.0", "win32", "x64", executable, false},
		{"prerelease", "22.0.0-rc.1", "win32", "x64", executable, false},
		{"malformed", "22junk.1.1", "win32", "x64", executable, false},
		{"leading-zero", "022.0.0", "win32", "x64", executable, false},
		{"wrong-platform", "22.0.0", "linux", "x64", executable, false},
		{"wrong-architecture", "22.0.0", "win32", "arm64", executable, false},
		{"missing-platform", "22.0.0", "", "x64", executable, false},
		{"relative-executable", "22.0.0", "win32", "x64", "node.exe", false},
		{"shadowed-executable", "22.0.0", "win32", "x64", executable + ".other", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			output, _ := json.Marshal(nodeInfo{test.version, test.platform, test.arch, test.execPath})
			err := validateNode(output, executable, "win32", "x64")
			if (err == nil) != test.valid {
				t.Fatalf("valid=%v, got %v", test.valid, err)
			}
		})
	}
	for _, output := range []string{"null", "{}", "not-json", `{"version":22}`, `{} {}`} {
		if validateNode([]byte(output), executable, "win32", "x64") == nil {
			t.Fatalf("accepted invalid output %s", output)
		}
	}
}

func TestPreloadEnvironmentIsRemoved(t *testing.T) {
	input := []string{"PATH=a", "NODE_OPTIONS=--import=evil.mjs", "node_path=other", "COPILOT_HOME=home", "SOME_NODE_OPTIONS=keep"}
	expected := []string{"PATH=a", "COPILOT_HOME=home", "SOME_NODE_OPTIONS=keep"}
	if actual := runtimeEnvironment(input); !reflect.DeepEqual(actual, expected) {
		t.Fatalf("environment = %v", actual)
	}
}

func TestEntrypointIsRelativeToArchiveNotWorkingDirectory(t *testing.T) {
	// The explicit project-local parent keeps all fixtures out of the host temp directory.
	parent := filepath.Join("..", "..", ".test-data")
	if err := os.MkdirAll(parent, 0755); err != nil {
		t.Fatal(err)
	}
	root, err := os.MkdirTemp(parent, "winget launcher ")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(root) })
	root, _ = filepath.Abs(root)
	launcher := filepath.Join(root, "archive with spaces", "bin", "sdlc.exe")
	entry := filepath.Join(filepath.Dir(filepath.Dir(launcher)), "package", "bin", "sdlc.mjs")
	for _, file := range []string{launcher, entry} {
		if err := os.MkdirAll(filepath.Dir(file), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte("fixture"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	got, err := entrypoint(launcher)
	if err != nil || got != entry {
		t.Fatalf("entrypoint = %q, %v", got, err)
	}
	link := filepath.Join(root, "Microsoft", "WinGet", "Links", "sdlc.exe")
	if err := os.MkdirAll(filepath.Dir(link), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(launcher, link); err == nil {
		got, err = entrypoint(link)
		if err != nil || got != entry {
			t.Fatalf("linked entrypoint = %q, %v", got, err)
		}
	} else {
		t.Logf("symlink fixture unavailable on this host: %v", err)
	}
	if err := os.Remove(entry); err != nil {
		t.Fatal(err)
	}
	if _, err := entrypoint(launcher); err == nil {
		t.Fatal("missing payload accepted")
	}
	if err := os.Mkdir(entry, 0755); err != nil {
		t.Fatal(err)
	}
	if _, err := entrypoint(launcher); err == nil {
		t.Fatal("directory payload accepted")
	}
	os.Remove(entry)
	if err := os.Symlink(launcher, entry); err == nil {
		if _, err := entrypoint(launcher); err == nil {
			t.Fatal("escaping payload link accepted")
		}
	}
}
