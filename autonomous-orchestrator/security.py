"""
Security module for Autonomous Coding Agent.

Implements bash command allowlisting and other security measures
to ensure safe autonomous execution.
"""

import re
import shlex
from typing import List, Tuple, Set
from pathlib import Path


# Allowed commands and their permitted flags
ALLOWED_COMMANDS: dict[str, Set[str]] = {
    # File operations (read-only or project-scoped)
    "ls": {"-la", "-l", "-a", "-h", "-R", "--color"},
    "cat": set(),
    "head": {"-n"},
    "tail": {"-n", "-f"},
    "less": set(),
    "more": set(),
    "find": {"-name", "-type", "-path", "-maxdepth", "-exec"},
    "grep": {"-r", "-n", "-i", "-l", "-E", "-v", "--include", "--exclude"},
    "rg": {"-n", "-i", "-l", "-e", "--glob", "-t", "--type"},
    "wc": {"-l", "-w", "-c"},
    "diff": {"-u", "-r", "--color"},
    "file": set(),

    # Directory operations
    "pwd": set(),
    "cd": set(),
    "mkdir": {"-p"},
    "rmdir": set(),

    # File manipulation (project-scoped)
    "touch": set(),
    "cp": {"-r", "-R"},
    "mv": set(),
    "rm": {"-r", "-rf", "-f"},

    # Git operations
    "git": {
        "status", "diff", "log", "show", "branch", "checkout", "add",
        "commit", "push", "pull", "fetch", "merge", "rebase", "stash",
        "reset", "clean", "worktree", "remote", "tag", "init", "clone"
    },

    # Package managers
    "npm": {"install", "run", "test", "build", "start", "ci", "audit"},
    "npx": set(),
    "yarn": {"install", "run", "test", "build", "start"},
    "pnpm": {"install", "run", "test", "build", "start"},
    "pip": {"install", "freeze", "list"},
    "pip3": {"install", "freeze", "list"},
    "poetry": {"install", "run", "build", "add"},
    "cargo": {"build", "run", "test", "check", "clippy"},

    # Build tools
    "make": set(),
    "cmake": set(),
    "gradle": {"build", "test", "run"},
    "mvn": {"clean", "install", "test", "package"},

    # Testing tools
    "jest": set(),
    "pytest": set(),
    "vitest": set(),
    "mocha": set(),
    "go": {"test", "build", "run", "mod"},

    # Linters and formatters
    "eslint": set(),
    "prettier": set(),
    "tsc": set(),
    "black": set(),
    "ruff": set(),
    "rustfmt": set(),

    # Process info (read-only)
    "ps": {"aux", "-ef"},
    "which": set(),
    "echo": set(),
    "printf": set(),
    "date": set(),
    "env": set(),

    # Archive tools
    "tar": {"-xf", "-cf", "-xzf", "-czf", "-tvf"},
    "unzip": set(),
    "zip": {"-r"},

    # Network tools (limited)
    "curl": {"-s", "-o", "-L", "-X", "-H", "-d", "--data"},
    "wget": {"-O", "-q"},
}

# Commands that should NEVER be allowed
BLOCKED_COMMANDS: Set[str] = {
    "sudo", "su", "chmod", "chown", "chgrp",
    "shutdown", "reboot", "halt", "poweroff",
    "dd", "mkfs", "fdisk", "parted",
    "iptables", "firewall-cmd", "ufw",
    "systemctl", "service",
    "kill", "killall", "pkill",
    "nc", "netcat", "nmap",
    "ssh", "scp", "sftp",
    "passwd", "useradd", "userdel", "usermod",
    "crontab", "at",
}

# Dangerous patterns to block
DANGEROUS_PATTERNS: List[re.Pattern] = [
    re.compile(r"rm\s+-rf\s+/"),  # rm -rf /
    re.compile(r">\s*/dev/"),      # Writing to /dev/
    re.compile(r"mkfs"),           # Filesystem formatting
    re.compile(r":\(\)\{.*\}"),    # Fork bomb
    re.compile(r"eval\s+"),        # eval command
    re.compile(r"\$\(.*\)"),       # Command substitution (can be dangerous)
    re.compile(r"`.*`"),           # Backtick command substitution
    re.compile(r";\s*rm\s"),       # Command chaining with rm
    re.compile(r"\|\s*sh"),        # Piping to shell
    re.compile(r"\|\s*bash"),      # Piping to bash
    re.compile(r">\s*/etc/"),      # Writing to /etc
    re.compile(r">\s*~/.ssh/"),    # Writing to .ssh
]


def parse_command(command: str) -> Tuple[str, List[str]]:
    """Parse a command string into command name and arguments."""
    try:
        parts = shlex.split(command)
        if not parts:
            return "", []
        return parts[0], parts[1:]
    except ValueError:
        return command.split()[0] if command.split() else "", []


def is_path_safe(path: str, project_root: Path) -> bool:
    """Check if a path is within the project root."""
    try:
        resolved = Path(path).resolve()
        return resolved.is_relative_to(project_root) or str(resolved).startswith(str(project_root))
    except (ValueError, OSError):
        return False


def check_command(command: str, project_root: Path) -> Tuple[bool, str]:
    """
    Check if a command is allowed to execute.

    Returns:
        Tuple of (is_allowed, reason)
    """
    if not command.strip():
        return False, "Empty command"

    # Check for dangerous patterns
    for pattern in DANGEROUS_PATTERNS:
        if pattern.search(command):
            return False, f"Command matches dangerous pattern: {pattern.pattern}"

    # Parse command
    cmd_name, args = parse_command(command)

    # Check if command is blocked
    if cmd_name in BLOCKED_COMMANDS:
        return False, f"Command '{cmd_name}' is blocked for security reasons"

    # Check if command is in allowlist
    if cmd_name not in ALLOWED_COMMANDS:
        return False, f"Command '{cmd_name}' is not in the allowlist"

    # For git commands, check subcommand
    if cmd_name == "git" and args:
        subcommand = args[0]
        allowed_subcommands = ALLOWED_COMMANDS["git"]
        if isinstance(allowed_subcommands, set) and subcommand not in allowed_subcommands:
            return False, f"Git subcommand '{subcommand}' is not allowed"

    # Check for path traversal in arguments
    for arg in args:
        if arg.startswith("-"):
            continue
        # Check if argument looks like a path
        if "/" in arg or "\\" in arg or arg.startswith("."):
            if not is_path_safe(arg, project_root):
                # Allow relative paths that don't escape project
                if not arg.startswith("..") and not arg.startswith("/"):
                    continue
                return False, f"Path '{arg}' is outside project root"

    return True, "Command allowed"


def sanitize_output(output: str) -> str:
    """Remove sensitive information from command output."""
    # Patterns to redact
    patterns = [
        (r"sk-[a-zA-Z0-9]{48}", "[REDACTED_API_KEY]"),
        (r"ANTHROPIC_API_KEY=[^\s]+", "ANTHROPIC_API_KEY=[REDACTED]"),
        (r"Bearer\s+[a-zA-Z0-9\-._~+/]+=*", "Bearer [REDACTED]"),
        (r"password[=:]\s*[^\s]+", "password=[REDACTED]"),
        (r"token[=:]\s*[^\s]+", "token=[REDACTED]"),
        (r"secret[=:]\s*[^\s]+", "secret=[REDACTED]"),
    ]

    result = output
    for pattern, replacement in patterns:
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)

    return result


class BashSecurityFilter:
    """Security filter for bash command execution."""

    def __init__(self, project_root: Path):
        self.project_root = project_root.resolve()

    def is_allowed(self, command: str) -> Tuple[bool, str]:
        """Check if a command is allowed."""
        return check_command(command, self.project_root)

    def filter_output(self, output: str) -> str:
        """Filter sensitive information from output."""
        return sanitize_output(output)
