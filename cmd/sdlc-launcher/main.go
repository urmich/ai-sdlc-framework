// Copyright (c) ai-sdlc-framework contributors. Licensed under the MIT license.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const runtimeProbe = `process.stdout.write(JSON.stringify({version:process.versions.node,platform:process.platform,arch:process.arch,execPath:process.execPath}))`

var nodeVersion = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`)

type nodeInfo struct {
	Version  string `json:"version"`
	Platform string `json:"platform"`
	Arch     string `json:"arch"`
	ExecPath string `json:"execPath"`
}

func entrypoint(executable string) (string, error) {
	// WinGet owns the Links alias; resolve it before locating the archive payload.
	resolved, err := filepath.EvalSymlinks(executable)
	if err != nil {
		return "", fmt.Errorf("resolve installed launcher: %w", err)
	}
	root, err := filepath.Abs(filepath.Join(filepath.Dir(resolved), ".."))
	if err != nil {
		return "", err
	}
	entry := filepath.Join(root, "package", "bin", "sdlc.mjs")
	resolvedEntry, err := filepath.EvalSymlinks(entry)
	if err != nil {
		return "", fmt.Errorf("installed package/bin/sdlc.mjs is unavailable: %w", err)
	}
	relative, err := filepath.Rel(filepath.Join(root, "package"), resolvedEntry)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", errors.New("installed CLI entrypoint escapes the archive payload")
	}
	info, err := os.Stat(resolvedEntry)
	if err != nil || !info.Mode().IsRegular() {
		return "", errors.New("installed CLI entrypoint must be a regular file")
	}
	return resolvedEntry, nil
}

func runtimeEnvironment(environment []string) []string {
	result := make([]string, 0, len(environment))
	for _, variable := range environment {
		key, _, _ := strings.Cut(variable, "=")
		// A preload must not execute before runtime validation or replace the CLI.
		if !strings.EqualFold(key, "NODE_OPTIONS") && !strings.EqualFold(key, "NODE_PATH") {
			result = append(result, variable)
		}
	}
	return result
}

func validateNode(output []byte, selected, platform, arch string) error {
	var info nodeInfo
	if err := json.Unmarshal(output, &info); err != nil {
		return errors.New("selected Node returned an invalid runtime probe")
	}
	version := nodeVersion.FindStringSubmatch(info.Version)
	if version == nil {
		return errors.New("selected Node must report a stable Node.js version 22 or later")
	}
	major, err := strconv.Atoi(version[1])
	if err != nil || major < 22 {
		return fmt.Errorf("Node.js 22 or later is required; selected Node reports %q", info.Version)
	}
	if info.Platform != platform || info.Arch != arch {
		return fmt.Errorf("selected Node must be native %s/%s; received %s/%s", platform, arch, info.Platform, info.Arch)
	}
	if !filepath.IsAbs(info.ExecPath) {
		return errors.New("selected Node did not report an absolute executable path")
	}
	reported, err := filepath.EvalSymlinks(info.ExecPath)
	if err != nil {
		return fmt.Errorf("resolve reported Node executable: %w", err)
	}
	selectedInfo, selectedErr := os.Stat(selected)
	reportedInfo, reportedErr := os.Stat(reported)
	if selectedErr != nil || reportedErr != nil || !os.SameFile(selectedInfo, reportedInfo) {
		return errors.New("selected Node is shadowed: runtime executable differs from the validated path")
	}
	return nil
}

func findNode(environment []string, platform, arch string) (string, error) {
	selected, explicit := os.LookupEnv("SDLC_NODE")
	var err error
	if explicit {
		if !filepath.IsAbs(selected) {
			return "", errors.New("SDLC_NODE must identify an absolute Node.js 22+ executable")
		}
	} else {
		selected, err = exec.LookPath("node")
		if err != nil {
			return "", fmt.Errorf("Node.js 22+ must be available on PATH (current-directory commands are not accepted): %w", err)
		}
	}
	if !filepath.IsAbs(selected) {
		return "", errors.New("Node.js 22+ must resolve from an absolute PATH entry, not the current directory")
	}
	selected, err = filepath.EvalSymlinks(selected)
	if err != nil {
		return "", fmt.Errorf("resolve selected Node: %w", err)
	}
	if platform == "win32" && !strings.EqualFold(filepath.Ext(selected), ".exe") {
		return "", errors.New("selected Node is a non-executable shim; a native node.exe is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, selected, "--eval", runtimeProbe)
	command.Env = environment
	output, err := command.Output()
	if err != nil {
		return "", fmt.Errorf("selected Node runtime preflight failed: %w", err)
	}
	if err := validateNode(output, selected, platform, arch); err != nil {
		return "", err
	}
	return selected, nil
}

func launch(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	fail := func(err error) int {
		fmt.Fprintf(stderr, "sdlc: %v\n", err)
		return 1
	}
	executable, err := os.Executable()
	if err != nil {
		return fail(err)
	}
	entry, err := entrypoint(executable)
	if err != nil {
		return fail(err)
	}
	platform, arch := runtime.GOOS, runtime.GOARCH
	if platform == "windows" {
		platform = "win32"
	}
	if arch == "amd64" {
		arch = "x64"
	}
	if err := verifyInstalledPayload(executable, platform, arch); err != nil {
		return fail(fmt.Errorf("installed payload integrity check failed: %w", err))
	}
	environment := runtimeEnvironment(os.Environ())
	node, err := findNode(environment, platform, arch)
	if err != nil {
		return fail(err)
	}
	command := exec.Command(node, append([]string{entry}, args...)...)
	command.Env = environment
	command.Stdin, command.Stdout, command.Stderr = stdin, stdout, stderr
	if err := command.Run(); err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) && exit.ExitCode() >= 0 {
			return exit.ExitCode()
		}
		return fail(fmt.Errorf("execute installed CLI: %w", err))
	}
	return 0
}

func main() {
	os.Exit(launch(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}
