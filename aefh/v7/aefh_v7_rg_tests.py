#!/usr/bin/env python3
"""Numerical smoke tests for the AEFH v7 one-loop RG illustration.

These tests validate the calculator's stated approximation only. They do not
prove gauge unification or any physical claim made by AEFH.
"""
from __future__ import annotations

import math
import unittest

MZ = 91.188
LOG10_MZ = math.log10(MZ)
LN10_OVER_2PI = math.log(10.0) / (2.0 * math.pi)
ALPHA_MZ = (59.02, 29.58, 8.47)
B_SM = (4.1, -19.0 / 6.0, -7.0)
B_MSSM = (6.6, 1.0, -3.0)
LOG10_MSSM_THRESHOLD = 3.0


def evaluate(log10_mu: float, mode: str = "sm") -> tuple[float, float, float]:
    if not math.isfinite(log10_mu):
        raise ValueError("log10_mu must be finite")
    if mode not in {"sm", "mssm"}:
        raise ValueError("mode must be 'sm' or 'mssm'")
    if mode == "sm" or log10_mu <= LOG10_MSSM_THRESHOLD:
        dt = (log10_mu - LOG10_MZ) * LN10_OVER_2PI
        return tuple(a0 - b * dt for a0, b in zip(ALPHA_MZ, B_SM))  # type: ignore[return-value]
    dt_low = (LOG10_MSSM_THRESHOLD - LOG10_MZ) * LN10_OVER_2PI
    dt_high = (log10_mu - LOG10_MSSM_THRESHOLD) * LN10_OVER_2PI
    return tuple(
        a0 - b_sm * dt_low - b_mssm * dt_high
        for a0, b_sm, b_mssm in zip(ALPHA_MZ, B_SM, B_MSSM)
    )  # type: ignore[return-value]


def sin2_theta_w(alpha1_inv: float, alpha2_inv: float) -> float:
    denominator = (5.0 / 3.0) * alpha1_inv + alpha2_inv
    if denominator <= 0.0:
        raise ValueError("inverse couplings give a non-positive denominator")
    return alpha2_inv / denominator


def electroweak_crossing_log10() -> float:
    """Solve alpha_1^-1 = alpha_2^-1 analytically in the SM one-loop model."""
    b1, b2 = B_SM[0], B_SM[1]
    dt = (ALPHA_MZ[0] - ALPHA_MZ[1]) / (b1 - b2)
    return LOG10_MZ + dt / LN10_OVER_2PI


class RunningCouplingsTests(unittest.TestCase):
    def test_reference_point(self) -> None:
        self.assertEqual(evaluate(LOG10_MZ, "sm"), ALPHA_MZ)
        self.assertAlmostEqual(sin2_theta_w(*ALPHA_MZ[:2]), 0.2312, delta=0.0003)

    def test_high_scale_reference_values(self) -> None:
        a1, a2, a3 = evaluate(13.0, "sm")
        self.assertAlmostEqual(a1, 42.4321079, places=6)
        self.assertAlmostEqual(a2, 42.3917866, places=6)
        self.assertAlmostEqual(a3, 36.7907914, places=6)
        self.assertAlmostEqual(a2 - a3, 5.6009952, places=6)

    def test_electroweak_crossing_gives_tree_level_three_eighths(self) -> None:
        log_mu = electroweak_crossing_log10()
        a1, a2, _ = evaluate(log_mu, "sm")
        self.assertAlmostEqual(a1, a2, places=12)
        self.assertAlmostEqual(sin2_theta_w(a1, a2), 3.0 / 8.0, places=12)
        self.assertTrue(12.9 < log_mu < 13.1)

    def test_scenario_offset_does_not_change_rg_flow(self) -> None:
        log_mu = 13.0
        before = evaluate(log_mu, "sm")
        delta3 = 5.6009952
        after = (before[0], before[1], before[2] + delta3)
        self.assertEqual(before[0], after[0])
        self.assertEqual(before[1], after[1])
        self.assertAlmostEqual(after[1] - after[2], 0.0, delta=1e-5)
        self.assertEqual(evaluate(log_mu, "sm"), before)

    def test_mssm_threshold_is_continuous(self) -> None:
        just_below = evaluate(LOG10_MSSM_THRESHOLD - 1e-9, "mssm")
        at_threshold = evaluate(LOG10_MSSM_THRESHOLD, "mssm")
        just_above = evaluate(LOG10_MSSM_THRESHOLD + 1e-9, "mssm")
        for low, exact, high in zip(just_below, at_threshold, just_above):
            self.assertAlmostEqual(low, exact, delta=1e-7)
            self.assertAlmostEqual(high, exact, delta=1e-7)

    def test_invalid_inputs_fail_clearly(self) -> None:
        with self.assertRaises(ValueError):
            evaluate(float("nan"))
        with self.assertRaises(ValueError):
            evaluate(13.0, "unknown")


if __name__ == "__main__":
    unittest.main(verbosity=2)
