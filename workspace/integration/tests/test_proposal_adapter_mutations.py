"""Mutation proof for the proposal adapter's security properties.

Each mutation is applied to a scratch copy of the integration package, the
adapter tests run there, and the copy is discarded. The real tree is untouched.

Proven properties:
  - dropping the parameter-digest check lets tampered parameters through
  - dropping the banned-key scan lets authority claims through
  - inventing approval from the disposition authorizes from intent
  - accepting refused proposals sends what Genesis declined to propose
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

WORKSPACE = Path(__file__).resolve().parent.parent.parent
TARGETS = ["integration/tests/test_proposal_adapter.py"]

MUTATIONS = [
    ("digest check dropped (tampered parameters accepted)",
     "integration/proposal_adapter.py",
     "    if digest != canonical_parameters_digest(parameters):\n"
     "        raise ProposalAdapterError(\n"
     '            "refused: parameters do not match the proposal parameter_digest")',
     "    pass  # MUTATED",
     ["test_digest_mismatch_refused"]),
    ("banned-key scan dropped (authority claims pass through)",
     "integration/proposal_adapter.py",
     "    banned = _find_banned_keys(proposal, \"proposal\") + \\\n"
     '        _find_banned_keys(parameters, "parameters")',
     "    banned = []  # MUTATED",
     ["test_banned_keys_in_proposal_refused",
      "test_banned_keys_in_parameters_refused",
      "test_nested_banned_keys_refused",
      "test_host_fields_smuggled_in_proposal_refused"]),
    ("disposition invents approval (intent becomes authority)",
     "integration/proposal_adapter.py",
     "    label = session_id or run_id",
     "    interactive = interactive or disposition == \"approval_required\"  # MUTATED\n"
     "    label = session_id or run_id",
     ["test_approval_required_disposition_passes_through",
      "test_adapter_never_invents_approval"]),
    ("refused proposals are sent anyway",
     "integration/proposal_adapter.py",
     '    if disposition == "refused":',
     '    if False:  # MUTATED',
     ["test_refused_disposition_refused"]),
]


class MutationSensitivity(unittest.TestCase):
    def test_every_mutation_is_caught(self):
        failures: list[str] = []
        for label, rel, old, new, expect in MUTATIONS:
            with self.subTest(mutation=label):
                scratch = Path(tempfile.mkdtemp(prefix="mut_"))
                try:
                    for name in ("integration",):
                        shutil.copytree(WORKSPACE / name, scratch / name,
                                        ignore=shutil.ignore_patterns(
                                            "__pycache__", ".pytest_cache",
                                            ".agent-worker-test", "node_modules"))
                    target = scratch / rel
                    text = target.read_text(encoding="utf-8")
                    self.assertIn(old, text,
                                  f"mutation anchor missing: {label}")
                    target.write_text(text.replace(old, new, 1),
                                      encoding="utf-8")
                    proc = subprocess.run(
                        [sys.executable, "-m", "pytest", *TARGETS, "-q",
                         "--no-header", "-p", "no:cacheprovider"],
                        cwd=str(scratch), capture_output=True, text=True,
                        timeout=600)
                    out = proc.stdout + proc.stderr
                    if proc.returncode == 0:
                        failures.append(f"{label}: SUITE STILL GREEN")
                        continue
                    for name in expect:
                        if name not in out:
                            failures.append(
                                f"{label}: failed, but {name} was not the "
                                "failing test")
                finally:
                    shutil.rmtree(scratch, ignore_errors=True)
        self.assertEqual(failures, [], "mutation proof incomplete:\n" +
                         "\n".join(failures))


if __name__ == "__main__":
    unittest.main()
