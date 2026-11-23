#!/usr/bin/env python3
"""
Верификационный стенд AEFH v6.0 (Теоремы 11–13).
Проверяет конечномерные примеры потенциала, аномальных условий,
глобальную Z6-идентификацию, внутренний 48x48 оператор Юкавы и
асимптотику Gibbs-состояния. Устойчив к python3 -O.
Зависимости: NumPy и стандартная библиотека.

Это численная проверка конкретных параметров и тестовых примеров,
а не доказательство общих утверждений или полноты физической теории.
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


def haar_unitary(rng: np.random.Generator, dim: int) -> np.ndarray:
    Z = (rng.standard_normal((dim, dim)) + 1j * rng.standard_normal((dim, dim))) / math.sqrt(2.0)
    Q, R = np.linalg.qr(Z)
    d = np.diag(R)
    return Q * (d / np.abs(d))


def haar_su(rng: np.random.Generator, dim: int) -> np.ndarray:
    U = haar_unitary(rng, dim)
    det = np.linalg.det(U)
    return U * (det ** (-1.0 / dim))


def augment_unitary(W: np.ndarray) -> np.ndarray:
    N = W.shape[0]
    out = np.eye(N + 1, dtype=complex)
    out[:N, :N] = W
    return out


def block_diag(blocks: list[np.ndarray]) -> np.ndarray:
    total = sum(b.shape[0] for b in blocks)
    out = np.zeros((total, total), dtype=complex)
    idx = 0
    for b in blocks:
        n = b.shape[0]
        out[idx : idx + n, idx : idx + n] = b
        idx += n
    return out


def rank1_probe(psi: np.ndarray, mu0: float) -> np.ndarray:
    dim = psi.shape[0]
    mu1 = (1.0 - mu0) * dim
    return mu0 * np.eye(dim, dtype=complex) + mu1 * np.outer(psi, psi.conj())


def pinch_block(X: np.ndarray, n_fund: int) -> np.ndarray:
    """Условное ожидание E(X) = P_fund X P_fund + P_vac X P_vac."""
    out = np.zeros_like(X)
    out[:n_fund, :n_fund] = X[:n_fund, :n_fund]
    out[n_fund:, n_fund:] = X[n_fund:, n_fund:]
    return out


class TestAEFHv6FinalArchitecture(unittest.TestCase):
    def test_11_theorem11_entropic_higgs_potential_and_ssb(self) -> None:
        rng = np.random.default_rng(11001)
        mu0, a_vac, alpha = 0.35, 0.40, 1.2

        for N in (2, 3):
            dim = N + 1
            mu1 = (1.0 - mu0) * dim
            b_vac = a_vac + (1.0 - a_vac) * dim
            Sigma_vac = np.diag([a_vac] * N + [b_vac]).astype(complex)
            I_dim = np.eye(dim, dtype=complex)
            e_vac = np.zeros(dim, dtype=complex)
            e_vac[-1] = 1.0

            self.assertAlmostEqual(tr_norm(Sigma_vac), 1.0, places=14)

            eta_alpha = math.log(b_vac / a_vac) + alpha * (
                (math.sqrt(mu0 + mu1) - math.sqrt(mu0))
                * (math.sqrt(b_vac) - math.sqrt(a_vac))
                / mu1
            )
            rho_max = math.log(1.0 + mu1 / mu0)
            self.assertGreater(eta_alpha, 0.0)

            def V_matrix(psi: np.ndarray, beta_vac: float, beta_ent: float) -> float:
                sig = rank1_probe(psi, mu0)
                return beta_vac * i_alpha(sig, Sigma_vac, alpha) + beta_ent * rel_entropy(
                    pinch_block(sig, N), I_dim
                )

            def delta_V_analytic(x: float, beta_vac: float, beta_ent: float) -> float:
                l1 = mu0 + mu1 * x
                l2 = mu0 + mu1 * (1.0 - x)
                s_term = (
                    l1 * math.log(l1)
                    + l2 * math.log(l2)
                    - mu0 * math.log(mu0)
                    - (mu0 + mu1) * math.log(mu0 + mu1)
                )
                r = beta_vac * eta_alpha / beta_ent
                return (beta_vac * mu1 * eta_alpha * x + beta_ent * s_term) / dim

            # Совпадение матричного потенциала с аналитическим выражением и U(N)-инвариантность.
            beta_ent = 1.0
            r_broken = 0.65 * rho_max
            beta_vac_broken = r_broken * beta_ent / eta_alpha
            v0_mat = V_matrix(e_vac, beta_vac_broken, beta_ent)

            for _ in range(15):
                psi = rng.standard_normal(dim) + 1j * rng.standard_normal(dim)
                psi /= np.linalg.norm(psi)
                x = float(np.vdot(psi[:N], psi[:N]).real)
                dv_num = V_matrix(psi, beta_vac_broken, beta_ent) - v0_mat
                dv_ana = delta_V_analytic(x, beta_vac_broken, beta_ent)
                self.assertAlmostEqual(dv_num, dv_ana, places=12)

                g_aug = augment_unitary(haar_unitary(rng, N))
                phase = np.exp(1j * rng.uniform(0.0, 2.0 * math.pi))
                self.assertAlmostEqual(
                    V_matrix(phase * (g_aug @ psi), beta_vac_broken, beta_ent),
                    V_matrix(psi, beta_vac_broken, beta_ent),
                    places=12,
                )

            # Симметричная фаза: минимум в x=0.
            r_sym = 1.25 * rho_max
            beta_vac_sym = r_sym * beta_ent / eta_alpha
            v0_sym = V_matrix(e_vac, beta_vac_sym, beta_ent)
            for th in np.linspace(0.05, 0.5 * math.pi, 40):
                psi_th = np.zeros(dim, dtype=complex)
                psi_th[N - 1] = math.sin(th)
                psi_th[N] = math.cos(th)
                self.assertGreater(V_matrix(psi_th, beta_vac_sym, beta_ent), v0_sym)

            # Нарушенная фаза: точный минимум и радиальная кривизна.
            x0 = (mu1 - mu0 * (math.exp(r_broken) - 1.0)) / (mu1 * (math.exp(r_broken) + 1.0))
            self.assertGreater(x0, 0.0)
            self.assertLess(x0, 0.5)
            theta0 = math.asin(math.sqrt(x0))

            def V_of_theta(th: float) -> float:
                p = np.zeros(dim, dtype=complex)
                p[N - 1] = math.sin(th)
                p[N] = math.cos(th)
                return V_matrix(p, beta_vac_broken, beta_ent)

            v_min = V_of_theta(theta0)
            self.assertLess(v_min, v0_mat)
            grid_vals = [V_of_theta(th) for th in np.linspace(0.0, 0.5 * math.pi, 200)]
            self.assertLessEqual(v_min, min(grid_vals) + 1e-13)

            h = 1e-4
            d1_num = (V_of_theta(theta0 + h) - V_of_theta(theta0 - h)) / (2.0 * h)
            d2_num = (V_of_theta(theta0 + h) - 2.0 * v_min + V_of_theta(theta0 - h)) / (h * h)
            d2_theory = (
                16.0 * beta_ent * (mu1**2) * x0 * (1.0 - x0)
                * (math.cosh(0.5 * r_broken) ** 2) / (dim * (2.0 * mu0 + mu1))
            )
            self.assertLess(abs(d1_num), 1e-7)
            self.assertLess(abs(d2_num - d2_theory) / d2_theory, 1e-5)

            # U(N)/U(N-1) орбита имеет постоянное значение потенциала.
            psi0 = np.zeros(dim, dtype=complex)
            psi0[N - 1] = math.sin(theta0)
            psi0[N] = math.cos(theta0)
            for _ in range(10):
                H_raw = rng.standard_normal((N, N)) + 1j * rng.standard_normal((N, N))
                H_herm = 0.5 * (H_raw + H_raw.conj().T)
                psi_orb = augment_unitary(mat_expm_iherm(0.25 * H_herm)) @ psi0
                self.assertAlmostEqual(
                    V_matrix(psi_orb, beta_vac_broken, beta_ent), v_min, places=12
                )

            # Критическая граница: x0 -> 0 и rho_cust -> 1+.
            r_near = 0.99 * rho_max
            x0_near = (mu1 - mu0 * (math.exp(r_near) - 1.0)) / (mu1 * (math.exp(r_near) + 1.0))
            self.assertGreater(x0_near, 0.0)
            self.assertLess(x0_near, 0.02)
            self.assertLess(1.0 / (1.0 - x0_near), 1.02)

    def test_12_theorem12_sm_anomalies_global_form_and_weinberg_3_8(self) -> None:
        # Локальные аномальные условия при стандартной нормировке гиперзаряда.
        yQ, yu, yd, yL, ye = 1.0 / 6.0, 2.0 / 3.0, -1.0 / 3.0, -0.5, -1.0
        self.assertAlmostEqual(2.0 * yQ - yu - yd, 0.0, places=14)
        self.assertAlmostEqual(3.0 * yQ + yL, 0.0, places=14)
        self.assertAlmostEqual(6.0 * yQ - 3.0 * yu - 3.0 * yd + 2.0 * yL - ye, 0.0, places=14)
        self.assertAlmostEqual(
            6.0 * yQ**3 - 3.0 * yu**3 - 3.0 * yd**3 + 2.0 * yL**3 - ye**3,
            0.0, places=14
        )
        self.assertEqual(2 - 1 - 1, 0)  # SU(3)^3: два Q_L-триплета минус u_R^c,d_R^c.
        self.assertEqual((3 + 1) % 2, 0)  # Число левых SU(2)-дублетов чётно.

        # Факторизация кубической аномалии при y_u=y_Q+delta, y_d=y_Q-delta.
        for yq_test, delta_test in ((0.3, 0.5), (-0.7, 1.1), (1.0 / 6.0, 0.5)):
            yl_t, ye_t = -3.0 * yq_test, -6.0 * yq_test
            yu_t, yd_t = yq_test + delta_test, yq_test - delta_test
            cubic_anom = (
                6.0 * yq_test**3 - 3.0 * yu_t**3 - 3.0 * yd_t**3
                + 2.0 * yl_t**3 - ye_t**3
            )
            self.assertAlmostEqual(
                cubic_anom, 18.0 * yq_test * (9.0 * yq_test**2 - delta_test**2), places=13
            )

        # Локальные аномалии задают гиперзаряды с точностью до общего масштаба.
        self.assertAlmostEqual(yu / yQ, 4.0, places=14)
        self.assertAlmostEqual(yd / yQ, -2.0, places=14)
        self.assertAlmostEqual(yL / yQ, -3.0, places=14)
        self.assertAlmostEqual(ye / yQ, -6.0, places=14)

        # Нормировка Y используется в кривизне; q=6Y — целые заряды U(1) для глобальной группы.
        qQ, qu, qd, qL, qe, qH = 6*yQ, 6*yu, 6*yd, 6*yL, 6*ye, 3
        self.assertEqual((qQ, qu, qd, qL, qe, qH), (1, 4, -2, -3, -6, 3))

        # Решёточное действие одного поколения в стандартных представлениях.
        T2_1 = 0.5 * np.array([[0, 1], [1, 0]], dtype=complex)
        T2_2 = 0.5 * np.array([[0, -1j], [1j, 0]], dtype=complex)
        T2_3 = 0.5 * np.array([[1, 0], [0, -1]], dtype=complex)

        T3_1 = 0.5 * np.array([[0, 1, 0], [1, 0, 0], [0, 0, 0]], dtype=complex)
        T3_2 = 0.5 * np.array([[0, -1j, 0], [1j, 0, 0], [0, 0, 0]], dtype=complex)
        T3_4 = 0.5 * np.array([[0, 0, 1], [0, 0, 0], [1, 0, 0]], dtype=complex)
        T3_6 = 0.5 * np.array([[0, 0, 0], [0, 0, 1], [0, 1, 0]], dtype=complex)

        def b1(x: float, y: float) -> float:
            return 0.4 - 0.3*y + 0.2*x*x - 0.35*y**3

        def b2(x: float, y: float) -> float:
            return 0.35 + 0.45*x - 0.15*y*y + 0.4*x**3

        def A2_1(x: float, y: float) -> np.ndarray:
            return (0.5 + 0.35*y + 0.2*x*x)*T2_1 + (0.3 - 0.25*x)*T2_3

        def A2_2(x: float, y: float) -> np.ndarray:
            return (0.55 + 0.4*x + 0.15*y*y)*T2_2 + (0.25 + 0.3*y)*T2_1

        def A3_1(x: float, y: float) -> np.ndarray:
            return (0.45 + 0.3*y + 0.2*x*x)*T3_1 + (0.35 - 0.25*x)*T3_4

        def A3_2(x: float, y: float) -> np.ndarray:
            return (0.5 + 0.4*x + 0.2*y*y)*T3_2 + (0.3 + 0.25*y)*T3_6

        x0, y0 = 0.2, -0.15

        def sm_plaquette_action(a: float, w_b: float = 1.0, w_2: float = 1.0, w_3: float = 1.0) -> float:
            flux_b = w_b * a * (
                b1(x0, y0 - 0.5*a) + b2(x0 + 0.5*a, y0)
                - b1(x0, y0 + 0.5*a) - b2(x0 - 0.5*a, y0)
            )
            W2 = (
                mat_expm_iherm(w_2*a*A2_1(x0, y0 - 0.5*a))
                @ mat_expm_iherm(w_2*a*A2_2(x0 + 0.5*a, y0))
                @ mat_expm_iherm(w_2*a*A2_1(x0, y0 + 0.5*a)).conj().T
                @ mat_expm_iherm(w_2*a*A2_2(x0 - 0.5*a, y0)).conj().T
            )
            W3 = (
                mat_expm_iherm(w_3*a*A3_1(x0, y0 - 0.5*a))
                @ mat_expm_iherm(w_3*a*A3_2(x0 + 0.5*a, y0))
                @ mat_expm_iherm(w_3*a*A3_1(x0, y0 + 0.5*a)).conj().T
                @ mat_expm_iherm(w_3*a*A3_2(x0 - 0.5*a, y0)).conj().T
            )
            W_QL = np.exp(1j*yQ*flux_b) * np.kron(W2, W3)
            W_uR = np.exp(1j*yu*flux_b) * W3
            W_dR = np.exp(1j*yd*flux_b) * W3
            W_LL = np.exp(1j*yL*flux_b) * W2
            W_eR = np.array([[np.exp(1j*ye*flux_b)]], dtype=complex)
            W_nuR = np.array([[1.0 + 0.0j]], dtype=complex)

            total = 0.0
            for Wr in (W_QL, W_uR, W_dR, W_LL, W_eR, W_nuR):
                d = Wr.shape[0]
                total += -float(np.trace(Wr - np.eye(d, dtype=complex)).real)
            return total

        self.assertAlmostEqual(sm_plaquette_action(0.1), sm_plaquette_action(-0.1), places=13)

        fB = (0.45 + 1.2*x0*x0) - (-0.3 - 1.05*y0*y0)
        F2 = 0.4*T2_2 - 0.35*T2_1 + 1j*(A2_1(x0,y0) @ A2_2(x0,y0) - A2_2(x0,y0) @ A2_1(x0,y0))
        F3 = 0.4*T3_2 - 0.3*T3_1 + 1j*(A3_1(x0,y0) @ A3_2(x0,y0) - A3_2(x0,y0) @ A3_1(x0,y0))
        tr_F2_sq = float(np.trace(F2 @ F2).real)
        tr_F3_sq = float(np.trace(F3 @ F3).real)
        lead_coeff = (5.0/3.0)*(fB**2) + 2.0*tr_F2_sq + 2.0*tr_F3_sq

        spacings = (0.16, 0.08, 0.04)
        rems = []
        for a in spacings:
            val = sm_plaquette_action(a)
            lead = (a**4)*lead_coeff
            rem = abs(val - lead)
            self.assertLess(rem/lead, 2e-2)
            rems.append(rem)
        self.assertTrue(5.85 < math.log2(rems[0]/rems[1]) < 6.15)
        self.assertTrue(5.92 < math.log2(rems[1]/rems[2]) < 6.08)

        a_small = 0.01
        inv_g3_sq = sm_plaquette_action(a_small, w_b=0.0, w_2=0.0, w_3=1.0)/(a_small**4*2.0*tr_F3_sq)
        inv_g2_sq = sm_plaquette_action(a_small, w_b=0.0, w_2=1.0, w_3=0.0)/(a_small**4*2.0*tr_F2_sq)
        inv_gY_sq = sm_plaquette_action(a_small, w_b=1.0, w_2=0.0, w_3=0.0)/(a_small**4*fB**2)
        # При конечном a_small остаётся O(a^2) поправка к отношению предельных коэффициентов.
        self.assertLess(abs(inv_g3_sq/inv_g2_sq - 1.0), 2e-4)
        self.assertLess(abs(inv_gY_sq/inv_g2_sq - 5.0/3.0)/(5.0/3.0), 2e-4)
        sin2_thetaW = inv_g2_sq/(inv_gY_sq + inv_g2_sq)
        self.assertLess(abs(sin2_thetaW - 3.0/8.0), 2e-4)

    def test_13_theorem13_chiral_dirac_yukawa_and_quartic_higgs(self) -> None:
        rng = np.random.default_rng(13001)
        N_g = 3
        I3 = np.eye(3, dtype=complex)
        I48 = np.eye(48, dtype=complex)
        gamma_F = np.diag([1.0]*24 + [-1.0]*24).astype(complex)

        def make_yukawa(svals: tuple[float, float, float]) -> np.ndarray:
            U = haar_unitary(rng, N_g)
            V = haar_unitary(rng, N_g)
            return U @ np.diag(svals) @ V.conj().T

        Yu = make_yukawa((1.25, 0.55, 0.25))
        Yd = make_yukawa((0.60, 0.35, 0.18))
        Ynu = make_yukawa((0.40, 0.22, 0.12))
        Ye = make_yukawa((0.50, 0.28, 0.15))

        def tilde_doublet(phi: np.ndarray) -> np.ndarray:
            return np.array([phi[1].conjugate(), -phi[0].conjugate()], dtype=complex)

        def dirac_op(phi: np.ndarray) -> np.ndarray:
            phi_dag = phi.conj().reshape(1, 2)
            tphi_dag = tilde_doublet(phi).conj().reshape(1, 2)
            M = np.zeros((24, 24), dtype=complex)
            M[0:9, 0:18] = np.kron(tphi_dag, np.kron(I3, Yu.conj().T))
            M[9:18, 0:18] = np.kron(phi_dag, np.kron(I3, Yd.conj().T))
            M[18:21, 18:24] = np.kron(tphi_dag, Ynu.conj().T)
            M[21:24, 18:24] = np.kron(phi_dag, Ye.conj().T)
            D = np.zeros((48, 48), dtype=complex)
            D[0:24, 24:48] = M.conj().T
            D[24:48, 0:24] = M
            return D

        def sm_gauge_matrix(g3: np.ndarray, g2: np.ndarray, theta: float) -> np.ndarray:
            # Глобальная форма: (SU(3) x SU(2) x U(1))/Z6, q=6Y — целые заряды.
            u_QL = np.exp(1j*theta) * np.kron(g2, np.kron(g3, I3))
            u_LL = np.exp(-3j*theta) * np.kron(g2, I3)
            u_uR = np.exp(4j*theta) * np.kron(g3, I3)
            u_dR = np.exp(-2j*theta) * np.kron(g3, I3)
            u_nuR = I3.copy()
            u_eR = np.exp(-6j*theta) * I3
            return block_diag([u_QL, u_LL, u_uR, u_dR, u_nuR, u_eR])

        phi = np.array([0.45 + 0.2j, 0.65 - 0.25j], dtype=complex)
        norm_phi = float(np.linalg.norm(phi))
        D_phi = dirac_op(phi)

        self.assertLess(np.linalg.norm(D_phi - D_phi.conj().T), 1e-14)
        self.assertLess(np.linalg.norm(D_phi @ gamma_F + gamma_F @ D_phi), 1e-14)

        # Z6 generator (omega_3 I3, -I2, exp(i*pi/3)) is represented trivially.
        omega3 = np.exp(2j*math.pi/3.0)
        U_z6 = sm_gauge_matrix(omega3*np.eye(3), -np.eye(2), math.pi/3.0)
        self.assertLess(np.linalg.norm(U_z6 - np.eye(48)), 1e-12)
        phi_z6 = np.exp(3j*math.pi/3.0) * (-np.eye(2) @ phi)
        self.assertLess(np.linalg.norm(phi_z6 - phi), 1e-14)

        for _ in range(10):
            g3 = haar_su(rng, 3)
            g2 = haar_su(rng, 2)
            th = float(rng.uniform(0.0, 2.0*math.pi))
            U_g = sm_gauge_matrix(g3, g2, th)
            phi_g = np.exp(3j*th) * (g2 @ phi)
            self.assertLess(np.linalg.norm(U_g @ D_phi @ U_g.conj().T - dirac_op(phi_g)), 1e-12)

        # Спектр D_F и унитарность CKM.
        u_uL, s_u, _ = np.linalg.svd(Yu)
        u_dL, s_d, _ = np.linalg.svd(Yd)
        u_nuL, s_nu, _ = np.linalg.svd(Ynu)
        u_eL, s_e, _ = np.linalg.svd(Ye)
        V_ckm = u_uL.conj().T @ u_dL
        V_pmns = u_nuL.conj().T @ u_eL
        self.assertLess(np.linalg.norm(V_ckm.conj().T @ V_ckm - I3), 1e-13)
        self.assertLess(np.linalg.norm(V_pmns.conj().T @ V_pmns - I3), 1e-13)
        self.assertGreater(np.linalg.norm(V_ckm - I3), 0.1)
        self.assertGreater(np.linalg.norm(V_pmns - I3), 0.1)

        pos_masses = np.concatenate([np.repeat(s_u, 3), np.repeat(s_d, 3), s_nu, s_e])*norm_phi
        expected_eigs = np.sort(np.concatenate([-pos_masses, pos_masses]))
        actual_eigs = np.linalg.eigvalsh(D_phi)
        self.assertLess(np.max(np.abs(actual_eigs - expected_eigs)), 1e-12)

        # Спектр Y^2 с повторением на H_L и H_R.
        y2_half = np.concatenate([
            np.repeat(s_u**2, 3), np.repeat(s_d**2, 3), s_nu**2, s_e**2
        ])
        y2_eigs = np.concatenate([y2_half, y2_half])
        mean_y2 = float(np.mean(y2_eigs))
        var_y2 = float(np.mean((y2_eigs - mean_y2)**2))
        cum3_y2 = float(np.mean((y2_eigs - mean_y2)**3))
        self.assertGreater(var_y2, 0.05)
        self.assertGreater(abs(cum3_y2), 0.05)

        alpha = 1.5
        D2 = D_phi @ D_phi

        def gibbs_state(eps_val: float) -> np.ndarray:
            vals, vecs = np.linalg.eigh(0.5*(D2 + D2.conj().T))
            boltz = np.exp(-eps_val*vals)
            rho = (vecs*boltz) @ vecs.conj().T
            return rho/tr_norm(rho)

        g2_test = haar_su(rng, 2)
        D_g = dirac_op(np.exp(3j*0.37)*(g2_test @ phi))
        D2_g = D_g @ D_g
        vals_g, vecs_g = np.linalg.eigh(0.5*(D2_g + D2_g.conj().T))
        rho_g = (vecs_g*np.exp(-0.04*vals_g)) @ vecs_g.conj().T
        rho_g /= tr_norm(rho_g)
        self.assertAlmostEqual(
            i_alpha(gibbs_state(0.04), I48, alpha),
            i_alpha(rho_g, I48, alpha),
            places=12
        )

        rems_3, rems_4 = [], []
        for eps_val in (0.08, 0.04, 0.02):
            val = i_alpha(gibbs_state(eps_val), I48, alpha)
            lead_2 = ((4.0+alpha)/8.0)*(eps_val**2)*var_y2*(norm_phi**4)
            sub_3 = -((16.0+3.0*alpha)/48.0)*(eps_val**3)*cum3_y2*(norm_phi**6)
            rems_3.append(abs(val - lead_2))
            rems_4.append(abs(val - (lead_2 + sub_3)))

        self.assertTrue(2.85 < math.log2(rems_3[0]/rems_3[1]) < 3.15)
        self.assertTrue(2.92 < math.log2(rems_3[1]/rems_3[2]) < 3.08)
        self.assertTrue(3.75 < math.log2(rems_4[0]/rems_4[1]) < 4.25)
        self.assertTrue(3.85 < math.log2(rems_4[1]/rems_4[2]) < 4.15)


if __name__ == "__main__":
    unittest.main(verbosity=2)
