#!/usr/bin/env python3
"""
Верификационный стенд AEFH v5.0 (Теоремы 9 и 10: фундаментальные заряды,
электромагнетизм U(1), чувствительность к центру Z_N и механизм Хиггса CP^N).
Устойчив к python3 -O (unittest), зависимости: только numpy и stdlib.

Покрытие:
  - test_9a_fundamental_adjoint_exact_2design_center_and_exotic_probe:
      Точный U(1) Максвелл (N=1); совпадение с 24-элементным 2-дизайном (1e-12)
      для общего 3x3 зонда в U(2); пробой слепоты к центру Z_2 и Z_3;
      проверка экзотического зонда с kappa_adj < 0 и C_SU(2) > 0;
      Haar-MC (4000 выборок) для U(3) и формулы когерентного зонда ранга 1.
  - test_9b_u1_maxwell_and_u2_continuum_limit_O_a6:
      Локальная калибровочная инвариантность, чётность по a и порядок остатка
      O(a^6) для пространственно переменного U(1)-поля (с кубическим членом)
      и полного неабелева U(2) = U(1) x SU(2) поля.
  - test_10a_cpn_fubini_study_link_action_and_O_a4:
      Точное тождество I_alpha(Sigma(psi2), Sigma(psi1)) = Lambda*(1 - |<psi1|psi2>|^2),
      локальная U(2) и фазовая инвариантность, чётность по a и порядок остатка
      O(a^4) для гладких переменных psi(x) и A_mu(x).
  - test_10b_higgs_mechanism_spectrum_u2_and_u3:
      Прямое численное вычисление массовой матрицы через гессиан I_alpha:
      для U(2) -> U(1)_em аналитически точная нулевая фотонная мода (численный гессиан: |lambda_min| < 1e-6),
      точные m_W^2, m_Z^2 и кастодиальный параметр rho_cust = 1 / cos^2(theta_0);
      для U(3) -> U(2) ровно (3-1)^2 = 4 нулевых и 5 положительных мод.
"""

import math
import unittest
import numpy as np


def tr_norm(A: np.ndarray) -> float:
    return float(np.trace(A).real) / A.shape[0]


def mat_func(A: np.ndarray, fn) -> np.ndarray:
    vals, vecs = np.linalg.eigh(0.5 * (A + A.conj().T))
    if np.any(vals <= 0.0):
        raise ValueError(f"Ожидалась строго положительная матрица, min eig={vals.min()}")
    return (vecs * fn(vals)) @ vecs.conj().T


def mat_expm_iherm(H: np.ndarray) -> np.ndarray:
    vals, vecs = np.linalg.eigh(0.5 * (H + H.conj().T))
    return (vecs * np.exp(1j * vals)) @ vecs.conj().T


def rel_entropy(rho: np.ndarray, sigma: np.ndarray) -> float:
    return tr_norm(rho @ (mat_func(rho, np.log) - mat_func(sigma, np.log)))


def affinity_half(rho: np.ndarray, sigma: np.ndarray) -> float:
    return tr_norm(mat_func(rho, np.sqrt) @ mat_func(sigma, np.sqrt))


def i_alpha(rho: np.ndarray, sigma: np.ndarray, alpha: float) -> float:
    return rel_entropy(rho, sigma) + alpha * (1.0 - affinity_half(rho, sigma))


def random_state(rng: np.random.Generator, dim: int, shift: float = 0.25) -> np.ndarray:
    A = rng.standard_normal((dim, dim)) + 1j * rng.standard_normal((dim, dim))
    rho = A @ A.conj().T + shift * np.eye(dim)
    return rho / tr_norm(rho)


def haar_unitary(rng: np.random.Generator, dim: int) -> np.ndarray:
    Z = (rng.standard_normal((dim, dim)) + 1j * rng.standard_normal((dim, dim))) / math.sqrt(2.0)
    Q, R = np.linalg.qr(Z)
    d = np.diag(R)
    return Q * (d / np.abs(d))


def clifford_1qubit_2design() -> list[np.ndarray]:
    H = np.array([[1.0, 1.0], [1.0, -1.0]], dtype=complex) / math.sqrt(2.0)
    S = np.array([[1.0, 0.0], [0.0, 1j]], dtype=complex)

    def canon(U: np.ndarray) -> np.ndarray:
        for z in U.reshape(-1):
            if abs(z) > 1e-8:
                return U * (z.conjugate() / abs(z))
        return U

    group = [np.eye(2, dtype=complex)]
    queue = [np.eye(2, dtype=complex)]
    while queue:
        cur = queue.pop()
        for gen in (H, S):
            cand = canon(cur @ gen)
            if not any(np.max(np.abs(cand - g)) < 1e-8 for g in group):
                group.append(cand)
                queue.append(cand)
    return group


def augment_unitary(W: np.ndarray) -> np.ndarray:
    """Блочное вложение W_tilde = W (+) 1 в U(N+1)."""
    N = W.shape[0]
    out = np.eye(N + 1, dtype=complex)
    out[:N, :N] = W
    return out


def one_minus_re_tau(W: np.ndarray) -> float:
    N = W.shape[0]
    return -float(np.trace(W - np.eye(N, dtype=complex)).real) / N


def one_minus_tau_adj(W: np.ndarray) -> float:
    N = W.shape[0]
    if N < 2:
        return 0.0
    z = complex(np.trace(W - np.eye(N, dtype=complex))) / N
    one_minus_abs2 = -2.0 * z.real - (z.real * z.real + z.imag * z.imag)
    return (N * N / (N * N - 1.0)) * one_minus_abs2


def fund_adj_kappas(sigma0: np.ndarray, alpha: float) -> tuple[float, float]:
    """Точные коэффициенты (kappa_fund, kappa_adj) из Теоремы 9 для Sigma_0 in M_{N+1}."""
    N = sigma0.shape[0] - 1
    log_s = mat_func(sigma0, np.log)
    sqrt_s = mat_func(sigma0, np.sqrt)

    A, v = sigma0[:N, :N], sigma0[:N, N]
    L, w = log_s[:N, :N], log_s[:N, N]
    B, u = sqrt_s[:N, :N], sqrt_s[:N, N]

    v_dot_w = float(np.vdot(v, w).real)
    u_norm2 = float(np.vdot(u, u).real)
    kappa_fund = (2.0 / (N + 1.0)) * (v_dot_w + alpha * u_norm2)

    if N == 1:
        return kappa_fund, 0.0

    term_s = float(np.trace(A @ L).real) - float(np.trace(A).real * np.trace(L).real) / N
    term_h = float(np.trace(B @ B).real) - (float(np.trace(B).real) ** 2) / N
    kappa_adj = (term_s + alpha * term_h) / (N + 1.0)
    return kappa_fund, kappa_adj


def rank1_probe(psi: np.ndarray, mu0: float) -> np.ndarray:
    """Когерентный зонд ранга 1 над трейс-вакуумом: mu0*I_{N+1} + mu1*|psi><psi|."""
    dim = psi.shape[0]
    mu1 = (1.0 - mu0) * dim
    if mu0 <= 0.0 or mu1 <= 0.0:
        raise ValueError("Требуется 0 < mu0 < 1")
    return mu0 * np.eye(dim, dtype=complex) + mu1 * np.outer(psi, psi.conj())


def lambda_alpha_rank1(dim: int, mu0: float, alpha: float) -> float:
    mu1 = (1.0 - mu0) * dim
    return (
        mu1 * math.log(1.0 + mu1 / mu0)
        + alpha * ((math.sqrt(mu0 + mu1) - math.sqrt(mu0)) ** 2)
    ) / dim


class TestAEFHv5HiggsAndU1(unittest.TestCase):
    def test_9a_fundamental_adjoint_exact_2design_center_and_exotic_probe(self) -> None:
        rng = np.random.default_rng(9001)

        # 1. Чистый U(1) (N = 1): точное компактное действие Вильсона — Максвелла
        sig_u1 = random_state(rng, 2, shift=0.2)
        Z_u1 = np.diag([1.0, -1.0])
        for alpha in (0.0, 1.5, 4.0):
            kf, ka = fund_adj_kappas(sig_u1, alpha)
            self.assertEqual(ka, 0.0)
            self.assertAlmostEqual(kf, 0.5 * i_alpha(Z_u1 @ sig_u1 @ Z_u1, sig_u1, alpha), places=13)
            self.assertGreater(kf, 0.0)
            for theta in (0.37, 1.85, math.pi):
                W_u1 = augment_unitary(np.array([[np.exp(1j * theta)]], dtype=complex))
                val = i_alpha(W_u1 @ sig_u1 @ W_u1.conj().T, sig_u1, alpha)
                self.assertAlmostEqual(val, kf * (1.0 - math.cos(theta)), places=13)

        # 2. U(2) (N = 2): точная проверка на 24-элементном 2-дизайне Клиффорда для общей Sigma_0
        clifford = clifford_1qubit_2design()
        sig_u2 = random_state(rng, 3, shift=0.2)
        Z_u2 = np.diag([1.0, 1.0, -1.0])
        W2 = haar_unitary(rng, 2)
        W2_aug = augment_unitary(W2)

        for alpha in (0.0, 1.25, 3.0):
            kf, ka = fund_adj_kappas(sig_u2, alpha)
            self.assertAlmostEqual(kf, 0.5 * i_alpha(Z_u2 @ sig_u2 @ Z_u2, sig_u2, alpha), places=12)

            avg_2design = 0.0
            for V in clifford:
                V_aug = augment_unitary(V)
                sig_v = V_aug @ sig_u2 @ V_aug.conj().T
                avg_2design += i_alpha(W2_aug @ sig_v @ W2_aug.conj().T, sig_v, alpha)
            avg_2design /= len(clifford)

            theory = kf * one_minus_re_tau(W2) + ka * one_minus_tau_adj(W2)
            self.assertAlmostEqual(avg_2design, theory, places=12)

            # Чувствительность к центру Z_2: W = -I_2
            W_center = -np.eye(2, dtype=complex)
            self.assertAlmostEqual(one_minus_tau_adj(W_center), 0.0, places=14)
            W_c_aug = augment_unitary(W_center)
            val_center = i_alpha(W_c_aug @ sig_u2 @ W_c_aug.conj().T, sig_u2, alpha)
            self.assertAlmostEqual(val_center, 2.0 * kf, places=12)
            self.assertGreater(val_center, 0.0)

        # 3. Экзотический зонд: kappa_adj < 0, но физическая жёсткость C_SU(2) > 0 и S(W) >= 0
        sig_ex = np.array(
            [[1.01, 0.0, 0.8], [0.0, 0.99, 0.0], [0.8, 0.0, 1.0]], dtype=complex
        )
        self.assertAlmostEqual(tr_norm(sig_ex), 1.0, places=15)
        kf_ex, ka_ex = fund_adj_kappas(sig_ex, alpha=0.0)
        self.assertLess(ka_ex, 0.0)
        c_su2_ex = kf_ex / 4.0 + (2.0 / 3.0) * ka_ex
        self.assertGreater(c_su2_ex, 0.1)
        for _ in range(30):
            W_rand = haar_unitary(rng, 2)
            s_val = kf_ex * one_minus_re_tau(W_rand) + ka_ex * one_minus_tau_adj(W_rand)
            self.assertGreaterEqual(s_val, -1e-13)

        # 4. Когерентный зонд ранга 1 (пункт 4 Теоремы 9) и Haar-MC для U(3) + центр Z_3
        mu0, theta0, alpha3 = 0.4, 0.55, 1.5
        psi0 = np.array([0.0, 0.0, math.sin(theta0), math.cos(theta0)], dtype=complex)
        sig_r1 = rank1_probe(psi0, mu0)
        lam_val = lambda_alpha_rank1(4, mu0, alpha3)
        kf_r1, ka_r1 = fund_adj_kappas(sig_r1, alpha3)
        self.assertAlmostEqual(
            kf_r1, 2.0 * lam_val * (math.sin(theta0) ** 2) * (math.cos(theta0) ** 2), places=13
        )
        self.assertAlmostEqual(
            ka_r1, (2.0 / 3.0) * lam_val * (math.sin(theta0) ** 4), places=13
        )

        # Центр Z_3 для U(3)
        z3 = np.exp(2j * math.pi / 3.0)
        W_z3 = augment_unitary(z3 * np.eye(3, dtype=complex))
        val_z3 = i_alpha(W_z3 @ sig_r1 @ W_z3.conj().T, sig_r1, alpha3)
        self.assertAlmostEqual(val_z3, kf_r1 * (1.0 - math.cos(2.0 * math.pi / 3.0)), places=12)

        # Haar-MC для U(3) (4000 выборок)
        W3 = haar_unitary(rng, 3)
        log_s = mat_func(sig_r1, np.log)
        sqrt_s = mat_func(sig_r1, np.sqrt)
        s0_ln_s0 = tr_norm(sig_r1 @ log_s)
        acc = 0.0
        n_mc = 4000
        for _ in range(n_mc):
            V = haar_unitary(rng, 3)
            U_aug = augment_unitary(V.conj().T @ W3 @ V)
            acc += (s0_ln_s0 - tr_norm(U_aug @ sig_r1 @ U_aug.conj().T @ log_s)) + alpha3 * (
                1.0 - tr_norm(U_aug @ sqrt_s @ U_aug.conj().T @ sqrt_s)
            )
        mc_mean = acc / n_mc
        theory_3 = kf_r1 * one_minus_re_tau(W3) + ka_r1 * one_minus_tau_adj(W3)
        self.assertLess(abs(mc_mean - theory_3), 0.025)

    def test_9b_u1_maxwell_and_u2_continuum_limit_O_a6(self) -> None:
        rng = np.random.default_rng(9002)
        x0, y0 = 0.2, -0.15
        spacings = (0.16, 0.08, 0.04)

        # --- Часть 1: чистый U(1) Максвелл (кубические члены дают нетривиальное O(a^6)) ---
        def a1_u1(x: float, y: float) -> float:
            return 0.5 - 0.35 * y + 0.2 * x * x - 0.4 * (y**3)

        def a2_u1(x: float, y: float) -> float:
            return 0.4 + 0.45 * x - 0.15 * y * y + 0.5 * (x**3)

        f12_u1 = (0.45 + 1.5 * x0 * x0) - (-0.35 - 1.2 * y0 * y0)
        sig_u1 = random_state(rng, 2, shift=0.25)
        kf_u1, _ = fund_adj_kappas(sig_u1, alpha=1.2)

        rem_u1 = []
        for a in spacings:
            flux = a * (
                a1_u1(x0, y0 - 0.5 * a)
                + a2_u1(x0 + 0.5 * a, y0)
                - a1_u1(x0, y0 + 0.5 * a)
                - a2_u1(x0 - 0.5 * a, y0)
            )
            s_plaq = kf_u1 * (1.0 - math.cos(flux))
            s_lead = 0.5 * kf_u1 * (a**4) * (f12_u1**2)
            rem = abs(s_plaq - s_lead)
            self.assertLess(rem / s_lead, 2e-2)
            rem_u1.append(rem)

        self.assertTrue(5.85 < math.log2(rem_u1[0] / rem_u1[1]) < 6.15)
        self.assertTrue(5.92 < math.log2(rem_u1[1] / rem_u1[2]) < 6.08)

        # --- Часть 2: полное неабелево U(2); на уровне алгебры Ли u(2)=u(1)⊕su(2) ---
        I2 = np.eye(2, dtype=complex)
        T1 = 0.5 * np.array([[0, 1], [1, 0]], dtype=complex)
        T2 = 0.5 * np.array([[0, -1j], [1j, 0]], dtype=complex)
        T3 = 0.5 * np.array([[1, 0], [0, -1]], dtype=complex)

        def A1_u2(x: float, y: float) -> np.ndarray:
            return (
                a1_u1(x, y) * I2
                + (0.5 + 0.3 * y + 0.2 * x * x) * T1
                + (0.4 - 0.25 * x + 0.15 * y * y) * T3
            )

        def A2_u2(x: float, y: float) -> np.ndarray:
            return (
                a2_u1(x, y) * I2
                + (0.6 + 0.4 * x + 0.2 * y * y) * T2
                + (0.35 + 0.3 * y - 0.15 * x * x) * T1
            )

        def plaquette_u2(a: float) -> np.ndarray:
            U1 = mat_expm_iherm(a * A1_u2(x0, y0 - 0.5 * a))
            U2 = mat_expm_iherm(a * A2_u2(x0 + 0.5 * a, y0))
            U3 = mat_expm_iherm(a * A1_u2(x0, y0 + 0.5 * a))
            U4 = mat_expm_iherm(a * A2_u2(x0 - 0.5 * a, y0))
            return U1 @ U2 @ U3.conj().T @ U4.conj().T

        d2_A1_su = 0.3 * T1 + (0.3 * y0) * T3
        d1_A2_su = 0.4 * T2 - (0.3 * x0) * T1
        A1_0, A2_0 = A1_u2(x0, y0), A2_u2(x0, y0)
        F12_su = d1_A2_su - d2_A1_su + 1j * (A1_0 @ A2_0 - A2_0 @ A1_0)
        self.assertAlmostEqual(abs(np.trace(F12_su)), 0.0, places=14)
        tr_Fsu2 = float(np.trace(F12_su @ F12_su).real)

        sig_u2 = random_state(rng, 3, shift=0.25)
        kf, ka = fund_adj_kappas(sig_u2, alpha=1.5)
        c_su2 = kf / 4.0 + (2.0 / 3.0) * ka
        self.assertGreater(c_su2, 0.0)

        # Чётность по a и локальная калибровочная инвариантность на 4 вершинах
        a_chk = 0.1
        W_p = plaquette_u2(a_chk)
        W_m = plaquette_u2(-a_chk)
        s_p = kf * one_minus_re_tau(W_p) + ka * one_minus_tau_adj(W_p)
        s_m = kf * one_minus_re_tau(W_m) + ka * one_minus_tau_adj(W_m)
        self.assertAlmostEqual(s_p, s_m, places=13)

        g1, g2, g3, g4 = [haar_unitary(rng, 2) for _ in range(4)]
        U1 = mat_expm_iherm(a_chk * A1_u2(x0, y0 - 0.5 * a_chk))
        U2 = mat_expm_iherm(a_chk * A2_u2(x0 + 0.5 * a_chk, y0))
        U3 = mat_expm_iherm(a_chk * A1_u2(x0, y0 + 0.5 * a_chk))
        U4 = mat_expm_iherm(a_chk * A2_u2(x0 - 0.5 * a_chk, y0))
        W_g = (
            (g1 @ U1 @ g2.conj().T)
            @ (g2 @ U2 @ g3.conj().T)
            @ (g4 @ U3 @ g3.conj().T).conj().T
            @ (g1 @ U4 @ g4.conj().T).conj().T
        )
        s_g = kf * one_minus_re_tau(W_g) + ka * one_minus_tau_adj(W_g)
        self.assertAlmostEqual(s_g, s_p, places=13)

        # Порядок остатка O(a^6) для полного U(2) действия
        rem_u2 = []
        for a in spacings:
            W = plaquette_u2(a)
            s_plaq = kf * one_minus_re_tau(W) + ka * one_minus_tau_adj(W)
            s_lead = (a**4) * (0.5 * kf * (f12_u1**2) + c_su2 * tr_Fsu2)
            rem = abs(s_plaq - s_lead)
            self.assertLess(rem / s_lead, 2e-2)
            rem_u2.append(rem)

        self.assertTrue(5.85 < math.log2(rem_u2[0] / rem_u2[1]) < 6.15)
        self.assertTrue(5.92 < math.log2(rem_u2[1] / rem_u2[2]) < 6.08)

    def test_10a_cpn_fubini_study_link_action_and_O_a4(self) -> None:
        rng = np.random.default_rng(10001)
        mu0, alpha = 0.35, 1.75

        # 1. Точное тождество Фубини — Штуди для N = 2 (dim = 3) и N = 3 (dim = 4)
        for dim in (3, 4):
            lam = lambda_alpha_rank1(dim, mu0, alpha)
            for _ in range(10):
                p1 = rng.standard_normal(dim) + 1j * rng.standard_normal(dim)
                p2 = rng.standard_normal(dim) + 1j * rng.standard_normal(dim)
                p1 /= np.linalg.norm(p1)
                p2 /= np.linalg.norm(p2)
                s_exact = i_alpha(rank1_probe(p2, mu0), rank1_probe(p1, mu0), alpha)
                perp = p2 - np.vdot(p1, p2) * p1
                self.assertAlmostEqual(s_exact, lam * float(np.vdot(perp, perp).real), places=12)

        # 2. Гладкий спинор psi(x) in C^3 и U(2) поле A(x): инвариантность, чётность, O(a^4)
        I2 = np.eye(2, dtype=complex)
        T1 = 0.5 * np.array([[0, 1], [1, 0]], dtype=complex)
        T2 = 0.5 * np.array([[0, -1j], [1j, 0]], dtype=complex)
        T3 = 0.5 * np.array([[1, 0], [0, -1]], dtype=complex)

        def u_and_du(x: float) -> tuple[np.ndarray, np.ndarray]:
            u = np.array(
                [
                    0.6 + 0.4 * math.sin(1.1 * x) + 0.2j * math.cos(0.9 * x),
                    0.5 * math.cos(1.3 * x) - 0.3j * math.sin(0.8 * x),
                    0.8 + 0.25 * math.sin(0.7 * x),
                ],
                dtype=complex,
            )
            du = np.array(
                [
                    0.44 * math.cos(1.1 * x) - 0.18j * math.sin(0.9 * x),
                    -0.65 * math.sin(1.3 * x) - 0.24j * math.cos(0.8 * x),
                    0.175 * math.cos(0.7 * x),
                ],
                dtype=complex,
            )
            return u, du

        def psi_fn(x: float) -> np.ndarray:
            u, _ = u_and_du(x)
            return u / np.linalg.norm(u)

        def dpsi_fn(x: float) -> np.ndarray:
            u, du = u_and_du(x)
            norm = np.linalg.norm(u)
            psi = u / norm
            return (du - psi * float(np.vdot(psi, du).real)) / norm

        def A_field(x: float) -> np.ndarray:
            return (
                (0.4 + 0.2 * x) * I2
                + (0.5 - 0.3 * x) * T1
                + (0.6 + 0.25 * x) * T2
                + (0.3 + 0.15 * x) * T3
            )

        x0 = 0.25
        psi0 = psi_fn(x0)
        A0_aug = np.zeros((3, 3), dtype=complex)
        A0_aug[:2, :2] = A_field(x0)
        D_psi0 = dpsi_fn(x0) + 1j * (A0_aug @ psi0)
        fs_density = float(np.vdot(D_psi0, D_psi0).real) - abs(np.vdot(psi0, D_psi0)) ** 2
        lam3 = lambda_alpha_rank1(3, mu0, alpha)

        def link_action(a: float) -> float:
            U_aug = augment_unitary(mat_expm_iherm(a * A_field(x0)))
            s_minus = rank1_probe(psi_fn(x0 - 0.5 * a), mu0)
            s_plus = rank1_probe(psi_fn(x0 + 0.5 * a), mu0)
            return i_alpha(U_aug @ s_plus @ U_aug.conj().T, s_minus, alpha)

        # Чётность по a, локальная U(2) и локальная фазовая инвариантность
        a_chk = 0.08
        self.assertAlmostEqual(link_action(a_chk), link_action(-a_chk), places=13)
        g_minus = augment_unitary(haar_unitary(rng, 2))
        g_plus = augment_unitary(haar_unitary(rng, 2))
        ph_minus = np.exp(1.13j)
        ph_plus = np.exp(-0.77j)
        U_raw = augment_unitary(mat_expm_iherm(a_chk * A_field(x0)))
        U_g = g_minus @ U_raw @ g_plus.conj().T
        s_m_g = rank1_probe(ph_minus * (g_minus @ psi_fn(x0 - 0.5 * a_chk)), mu0)
        s_p_g = rank1_probe(ph_plus * (g_plus @ psi_fn(x0 + 0.5 * a_chk)), mu0)
        self.assertAlmostEqual(
            i_alpha(U_g @ s_p_g @ U_g.conj().T, s_m_g, alpha),
            link_action(a_chk),
            places=13,
        )

        # Сходимость к CP^2-кинетике и порядок остатка O(a^4)
        spacings = (0.08, 0.04, 0.02)
        rems = []
        for a in spacings:
            val = link_action(a)
            lead = (a**2) * lam3 * fs_density
            rem = abs(val - lead)
            self.assertLess(rem / lead, 2e-2)
            rems.append(rem)

        self.assertTrue(3.90 < math.log2(rems[0] / rems[1]) < 4.10)
        self.assertTrue(3.95 < math.log2(rems[1] / rems[2]) < 4.05)

    def test_10b_higgs_mechanism_spectrum_u2_and_u3(self) -> None:
        mu0, theta0, alpha = 0.35, 0.42, 1.4
        eps = 1e-4

        # --- Часть 1: Электрослабый случай U(2) -> U(1)_em ---
        psi0 = np.array([0.0, math.sin(theta0), math.cos(theta0)], dtype=complex)
        sig0 = rank1_probe(psi0, mu0)
        lam3 = lambda_alpha_rank1(3, mu0, alpha)

        kf, ka = fund_adj_kappas(sig0, alpha)
        g_prime = 1.0 / math.sqrt(0.25 * kf)
        g_weak = 1.0 / math.sqrt(0.25 * kf + (2.0 / 3.0) * ka)

        # Канонический базис (W^1, W^2, W^3, B)
        s1 = np.array([[0, 1], [1, 0]], dtype=complex)
        s2 = np.array([[0, -1j], [1j, 0]], dtype=complex)
        s3 = np.array([[1, 0], [0, -1]], dtype=complex)
        I2 = np.eye(2, dtype=complex)
        basis_u2 = [0.5 * g_weak * s1, 0.5 * g_weak * s2, 0.5 * g_weak * s3, 0.5 * g_prime * I2]

        def f_mass_u2(v: np.ndarray) -> float:
            A = sum(c * E for c, E in zip(v, basis_u2))
            U = augment_unitary(mat_expm_iherm(A))
            return i_alpha(U @ sig0 @ U.conj().T, sig0, alpha)

        # Прямой численный 4x4 гессиан M^2_{ab} = d^2 f / (dv_a dv_b)
        M2_num = np.zeros((4, 4), dtype=float)
        for a in range(4):
            ea = np.zeros(4)
            ea[a] = eps
            M2_num[a, a] = 2.0 * f_mass_u2(ea) / (eps**2)
            for b in range(a + 1, 4):
                eb = np.zeros(4)
                eb[b] = eps
                val = (f_mass_u2(ea + eb) - f_mass_u2(ea - eb)) / (2.0 * eps * eps)
                M2_num[a, b] = M2_num[b, a] = val

        eigvals, eigvecs = np.linalg.eigh(M2_num)
        # 1. Строго безмассовый фотон и проверка его собственного вектора
        # Аналитическая мода точно нулевая; конечная разность при eps=1e-4 оставляет шум ~1e-7.\n        self.assertLess(abs(eigvals[0]), 1e-6)
        photon_exact = np.array([0.0, 0.0, g_prime, g_weak]) / math.hypot(g_weak, g_prime)
        self.assertAlmostEqual(abs(float(np.dot(eigvecs[:, 0], photon_exact))), 1.0, places=7)

        # 2. Точные массы W^+, W^-, Z^0 и кастодиальный параметр rho_cust = 1 / cos^2(theta_0)
        mW2_theory = 0.5 * lam3 * (g_weak**2) * (math.sin(theta0) ** 2)
        mZ2_theory = (
            0.5
            * lam3
            * (g_weak**2 + g_prime**2)
            * (math.sin(theta0) ** 2)
            * (math.cos(theta0) ** 2)
        )
        # Сортируем ожидаемые ненулевые массы (при малом theta0 mZ^2 > mW^2)
        expected_nonzero = sorted([mW2_theory, mW2_theory, mZ2_theory])
        for num_v, exp_v in zip(eigvals[1:], expected_nonzero):
            self.assertLess(abs(num_v - exp_v) / exp_v, 1e-6)

        # Вычисляем mW^2 и mZ^2 напрямую по проекции на W^1 и Z^0
        mW2_num = M2_num[0, 0]
        z_vec = np.array([0.0, 0.0, g_weak, -g_prime]) / math.hypot(g_weak, g_prime)
        mZ2_num = float(z_vec @ M2_num @ z_vec)
        cos2_thetaW = (g_weak**2) / (g_weak**2 + g_prime**2)
        rho_cust = mW2_num / (mZ2_num * cos2_thetaW)
        self.assertAlmostEqual(rho_cust, 1.0 / (math.cos(theta0) ** 2), places=6)

        # --- Часть 2: Проверка числа безмассовых и массивных мод для U(3) -> U(2) ---
        psi3 = np.array([0.0, 0.0, math.sin(theta0), math.cos(theta0)], dtype=complex)
        sig3 = rank1_probe(psi3, mu0)
        # Ортонормированный базис из 9 эрмитовых 3x3 матриц
        basis_u3 = []
        for i in range(3):
            E = np.zeros((3, 3), dtype=complex)
            E[i, i] = 1.0
            basis_u3.append(E)
        for i in range(3):
            for j in range(i + 1, 3):
                Es = np.zeros((3, 3), dtype=complex)
                Es[i, j] = Es[j, i] = 1.0 / math.sqrt(2.0)
                Ea = np.zeros((3, 3), dtype=complex)
                Ea[i, j] = -1j / math.sqrt(2.0)
                Ea[j, i] = 1j / math.sqrt(2.0)
                basis_u3.extend([Es, Ea])

        def f_mass_u3(v: np.ndarray) -> float:
            A = sum(c * E for c, E in zip(v, basis_u3))
            U = augment_unitary(mat_expm_iherm(A))
            return i_alpha(U @ sig3 @ U.conj().T, sig3, alpha)

        M2_u3 = np.zeros((9, 9), dtype=float)
        for a in range(9):
            ea = np.zeros(9)
            ea[a] = eps
            M2_u3[a, a] = 2.0 * f_mass_u3(ea) / (eps**2)
            for b in range(a + 1, 9):
                eb = np.zeros(9)
                eb[b] = eps
                val = (f_mass_u3(ea + eb) - f_mass_u3(ea - eb)) / (2.0 * eps * eps)
                M2_u3[a, b] = M2_u3[b, a] = val

        eigs_u3 = np.linalg.eigvalsh(M2_u3)
        # Четыре нулевые моды проверяются с численным допуском конечной разности.\n        zero_modes = int(np.sum(np.abs(eigs_u3) < 1e-6))
        massive_modes = int(np.sum(eigs_u3 > 1e-3))
        self.assertEqual(zero_modes, 4)     # (3 - 1)^2 = 4 безмассовых бозона U(3)
        self.assertEqual(massive_modes, 5)  # 2*3 - 1 = 5 массивных бозонов


if __name__ == "__main__":
    unittest.main(verbosity=2)
