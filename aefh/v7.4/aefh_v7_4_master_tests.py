#!/usr/bin/env python3
"""
Единый мастер-стенд верификации AEFH v7.4 (Теоремы 1-14, Следствия 5.1 и 5.2).
21 unittest-проверка, устойчивых к запуску с флагом `python3 -O`.
Зависимости: только стандартная библиотека Python и NumPy.

Нормировки и пределы численной модели:
  - В блоках 1-13 используются конечномерные матричные алгебры M_N с нормированным
    следом tau(A) = Tr(A) / N (tau(I_N) = 1); состояния удовлетворяют tau(rho) = 1.
    Это алгебры типа I_N, а не факторы типа II_1. В Теореме 7 для энтропии фон
    Неймана используется стандартная нормировка Tr(rho_L) = 1.
  - Тест 15 дополнительно проверяет двухшаговое резольвентное тождество для I_2(t) в каждом из 80 узлов и интегралы на конечномерной модели M_5 с весовым следом; это не является доказательством для произвольного фактора II_infty.
  - В блоке 14 проверяются масштабирование весового следа Tr_w(A) = w * Tr(A)
    и совместимость конечномерных CP-каналов. M_N остаётся алгеброй типа I_N:
    эти тесты не являются численной реализацией фактора II_infty и сами по себе
    не доказывают перенос утверждений на произвольный фактор II_infty.
  - Космологический блок проверяет иллюстративную динамику связанной квинтэссенции,
    а не выполняет статистический likelihood-fit к данным DESI DR2.

Карта 21 теста:
  01. Теорема 1  : метрики BKM/Хеллингера (log1p), порог gamma_loc = 4, 4-й порядок -(7/96)t^4.
  02. Теорема 2  : глобальная цепочка S >= -2 ln F_{1/2} >= 2(1 - F_{1/2}) и 2D свободный вакуум.
  03. Теорема 3  : точный конечномерный порог gamma_N (до N=10^8), леммы G''' > 0, G > 0, 600 Дирихле.
  04a. Теорема 4 : прямая матричная проверка сжатия Петца M_V^H M_V <= I и M_V^H Delta M_V <= Delta_Phi.
  04b. Теорема 4 : DPI для I_alpha (alpha >= 0) на трёх классах физических tau-каналов.
  04c. Теорема 4 : пробой DPI для любых gamma > 0 в M_3 (float64 + 60-значный Decimal) и M_N -> M_K.
  05a. Теорема 5 : дефицит площади геодезического шара и O(l0^6) на S^3, H^3, S^2 x R и переменной R(r).
  05b. Сл. 5.1-2 : FLRW + квинтэссенция и иллюстративная связанная модель с переходом w_eff через -1.
  06. Теорема 6  : центральное расщепление I_alpha на M_2 (+) M_3 (+) M_4.
  07. Теорема 7  : проектор Гаусса P_G для неабелевой S_3 и абелевой Z_3, 3-членная энтропия S_vN.
  08a. Теорема 8 : точный 24-элементный 2-дизайн Клиффорда (U(2)) и Haar-MC (U(3), 4000 выборок).
  08b. Теорема 8 : локальная калибровочная инвариантность, чётность и O(a^6) для SU(3) Янга - Миллса.
  09a. Теорема 9 : U(1) Максвелл, 2-дизайн для U(2), центр Z_2/Z_3, экзотический зонд kappa_adj < 0, U(3) MC.
  09b. Теорема 9 : непрерывный предел O(a^6) для неоднородных полей U(1) и U(2) = U(1) x SU(2).
  10a. Теорема 10: тождество Фубини - Штуди CP^N, калибровочная/фазовая инвариантность и O(a^4).
  10b. Теорема 10: спектр масс U(2) -> U(1)_em (m_gamma = 0, tan^2 theta_W, rho_cust) и U(3) -> U(2).
  11. Теорема 11 : U(N)-инвариантный энтропийный потенциал Хиггса, фазовый переход 2-го рода, m_H^2 > 0.
  12. Теорема 12 : 4 уравнения аномалий СМ, O(a^6) на 16D мультиплете и sin^2(theta_W) = 3/8 (Ричардсон).
  13. Теорема 13 : 48x48 киральный оператор Дирака (3 поколения), CKM, квартичное самодействие Хиггса.
  14. Теорема 14 : конечномерный тест весового следа + faithful-tail DPI-контрпример + 1-петлевой бег СМ.
"""

from decimal import Decimal, localcontext
import math
import unittest
import numpy as np


# =============================================================================
# Базовые матричные, энтропийные и геометрические ядра
# =============================================================================


def tr_norm(A: np.ndarray) -> float:
    """Нормированный след tau(A) = Tr(A) / N, где tau(I_N) = 1."""
    return float(np.trace(A).real) / A.shape[0]


def tr_semifinite(A: np.ndarray, weight: float) -> float:
    """Полуконечный (ненормированный) след Tr_w(A) = weight * Tr(A)."""
    return weight * float(np.trace(A).real)


def mat_func(A: np.ndarray, fn) -> np.ndarray:
    vals, vecs = np.linalg.eigh(0.5 * (A + A.conj().T))
    if np.any(vals <= 0.0):
        raise ValueError(f"Ожидалась строго положительная матрица, min eig={vals.min()}")
    return (vecs * fn(vals)) @ vecs.conj().T


def mat_expm_iherm(H: np.ndarray) -> np.ndarray:
    """Точная унитарная экспонента exp(i * H) для эрмитовой матрицы H."""
    vals, vecs = np.linalg.eigh(0.5 * (H + H.conj().T))
    return (vecs * np.exp(1j * vals)) @ vecs.conj().T


def rel_entropy(rho: np.ndarray, sigma: np.ndarray) -> float:
    return tr_norm(rho @ (mat_func(rho, np.log) - mat_func(sigma, np.log)))


def rel_entropy_w(rho: np.ndarray, sigma: np.ndarray, weight: float) -> float:
    return tr_semifinite(rho @ (mat_func(rho, np.log) - mat_func(sigma, np.log)), weight)


def affinity_p(rho: np.ndarray, sigma: np.ndarray, p: float = 0.5) -> float:
    """Квантовая аффинность Петца Q_p(rho, sigma) = tau(rho^p sigma^(1-p))."""
    return tr_norm(
        mat_func(rho, lambda x: x**p) @ mat_func(sigma, lambda x: x ** (1.0 - p))
    )


def affinity_half_w(rho: np.ndarray, sigma: np.ndarray, weight: float) -> float:
    return tr_semifinite(mat_func(rho, np.sqrt) @ mat_func(sigma, np.sqrt), weight)


def i_alpha(rho: np.ndarray, sigma: np.ndarray, alpha: float) -> float:
    return rel_entropy(rho, sigma) + alpha * (1.0 - affinity_p(rho, sigma, 0.5))


def vn_entropy(rho_tr1: np.ndarray) -> float:
    """Энтропия фон Неймана -Tr(rho ln rho) для матрицы со стандартным следом Tr(rho) = 1."""
    vals = np.linalg.eigvalsh(0.5 * (rho_tr1 + rho_tr1.conj().T))
    pos = vals[vals > 1e-15]
    return float(-np.sum(pos * np.log(pos)))


def exact_gamma_n(dim: int) -> float:
    """Устойчивое вычисление точного порога gamma_N при фиксированном sigma = I_N."""
    if dim < 2:
        raise ValueError("dim должно быть >= 2")
    x = 1.0 / dim
    log_ratio = math.log1p(-x)
    return (-log_ratio) / (-math.expm1(0.5 * log_ratio))


def analytical_hessians(
    sigma: np.ndarray, drho: np.ndarray, trace_weight: float | None = None
) -> tuple[float, float]:
    """Точные гессианы S(rho||sigma) и (1 - F_{1/2}) через устойчивый log1p."""
    vals, vecs = np.linalg.eigh(0.5 * (sigma + sigma.conj().T))
    D = vecs.conj().T @ drho @ vecs
    N = sigma.shape[0]
    w = (1.0 / N) if trace_weight is None else trace_weight
    a = vals[:, None]
    b = vals[None, :]

    u = (a - b) / b
    small = np.abs(u) < 1e-7
    u_safe = np.where(small, 1.0, u)
    K_bkm = np.where(
        small,
        (1.0 - 0.5 * u + (u**2) / 3.0 - 0.25 * (u**3)) / b,
        np.log1p(u_safe) / (b * u_safe),
    )
    K_h = 1.0 / (np.sqrt(a) + np.sqrt(b)) ** 2
    D2 = np.abs(D) ** 2
    return float(w * np.sum(K_bkm * D2)), float(w * np.sum(K_h * D2))


def random_state(rng: np.random.Generator, dim: int, shift: float = 0.25) -> np.ndarray:
    A = rng.standard_normal((dim, dim)) + 1j * rng.standard_normal((dim, dim))
    rho = A @ A.conj().T + shift * np.eye(dim)
    return rho / tr_norm(rho)


def random_state_w(
    rng: np.random.Generator, dim: int, weight: float, shift: float = 0.25
) -> np.ndarray:
    A = rng.standard_normal((dim, dim)) + 1j * rng.standard_normal((dim, dim))
    rho = A @ A.conj().T + shift * np.eye(dim)
    return rho / tr_semifinite(rho, weight)


def haar_unitary(rng: np.random.Generator, dim: int) -> np.ndarray:
    """Точно Хаар-равномерная унитарная матрица (алгоритм Меццадри с QR-коррекцией фаз)."""
    Z = (rng.standard_normal((dim, dim)) + 1j * rng.standard_normal((dim, dim))) / math.sqrt(2.0)
    Q, R = np.linalg.qr(Z)
    d = np.diag(R)
    return Q * (d / np.abs(d))


def haar_su(rng: np.random.Generator, dim: int) -> np.ndarray:
    U = haar_unitary(rng, dim)
    det = np.linalg.det(U)
    return U * (det ** (-1.0 / dim))


def clifford_1qubit_2design() -> list[np.ndarray]:
    """24-элементная проективная группа Клиффорда Cl_1 / U(1) (точный унитарный 2-дизайн)."""
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


def random_tau_channel_kraus(
    rng: np.random.Generator, n_in: int, k_out: int, num_kraus: int = 4
) -> list[np.ndarray]:
    """Операторы Крауса {A_j} с sum(A_j^H A_j) = I_{n_in}."""
    raw = [
        rng.standard_normal((k_out, n_in)) + 1j * rng.standard_normal((k_out, n_in))
        for _ in range(num_kraus)
    ]
    S = sum(B.conj().T @ B for B in raw)
    S_inv_sqrt = mat_func(S, lambda x: 1.0 / np.sqrt(x))
    return [B @ S_inv_sqrt for B in raw]


def apply_tau_channel(kraus: list[np.ndarray], X: np.ndarray) -> np.ndarray:
    k_out, n_in = kraus[0].shape
    return (k_out / n_in) * sum(A @ X @ A.conj().T for A in kraus)


def apply_semifinite_channel(
    kraus: list[np.ndarray], X: np.ndarray, w_in: float, w_out: float
) -> np.ndarray:
    """CP-канал, сохраняющий полуконечный след: Tr_{w_out}(Phi(X)) = Tr_{w_in}(X)."""
    return (w_in / w_out) * sum(A @ X @ A.conj().T for A in kraus)


def apply_tau_adjoint(kraus: list[np.ndarray], Y: np.ndarray) -> np.ndarray:
    return sum(A.conj().T @ Y @ A for A in kraus)


def block_diag(blocks: list[np.ndarray]) -> np.ndarray:
    total = sum(b.shape[0] for b in blocks)
    out = np.zeros((total, total), dtype=complex)
    idx = 0
    for b in blocks:
        n = b.shape[0]
        out[idx : idx + n, idx : idx + n] = b
        idx += n
    return out


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


def kappa_alpha_exact(sigma0: np.ndarray, alpha: float) -> float:
    """Точный коэффициент kappa_alpha(sigma_0) из Теоремы 8."""
    I_n = np.eye(sigma0.shape[0], dtype=complex)
    jeffreys = rel_entropy(sigma0, I_n) + rel_entropy(I_n, sigma0)
    f_val = affinity_p(sigma0, I_n, 0.5)
    return jeffreys + alpha * (1.0 - f_val * f_val)


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


def pinch_block(X: np.ndarray, n_fund: int) -> np.ndarray:
    """Условное ожидание E(X) = P_N X P_N + P_vac X P_vac на M_N (+) C."""
    out = np.zeros_like(X)
    out[:n_fund, :n_fund] = X[:n_fund, :n_fund]
    out[n_fund:, n_fund:] = X[n_fund:, n_fund:]
    return out


# =============================================================================
# Геометрические вспомогательные функции (Теорема 5)
# =============================================================================


def z_minus_sin(z: float) -> float:
    if abs(z) < 0.3:
        z2 = z * z
        return (z**3) * (
            1.0 / 6.0
            + z2 * (
                -1.0 / 120.0
                + z2 * (
                    1.0 / 5040.0
                    + z2 * (-1.0 / 362880.0 + z2 / 39916800.0)
                )
            )
        )
    return z - math.sin(z)


def sinh_minus_z(z: float) -> float:
    if abs(z) < 0.3:
        z2 = z * z
        return (z**3) * (
            1.0 / 6.0
            + z2 * (
                1.0 / 120.0
                + z2 * (
                    1.0 / 5040.0
                    + z2 * (1.0 / 362880.0 + z2 / 39916800.0)
                )
            )
        )
    return math.sinh(z) - z


def s2_x_r_ball_area_vol(r: float, a: float = 1.0) -> tuple[float, float]:
    """Высокоточная 24-точечная квадратура Гаусса - Лежандра площади A(r) и объёма V(r) на S^2(a) x R."""
    nodes, weights = np.polynomial.legendre.leggauss(24)
    alpha = 0.25 * math.pi * (nodes + 1.0)
    w = 0.25 * math.pi * weights
    k = np.sin(alpha) / a
    x = k * r

    area = 4.0 * math.pi * a * r * float(np.sum(w * np.sin(x)))

    small = np.abs(x) < 0.2
    x_safe = np.where(small, 1.0, x)
    k_safe = np.where(small, 1.0, k)
    x2 = x * x
    taylor_poly = (
        1.0 / 3.0
        + x2 * (
            -1.0 / 30.0
            + x2 * (
                1.0 / 840.0
                + x2 * (
                    -1.0 / 45360.0
                    + x2 * (1.0 / 3991680.0 - x2 / 518918400.0)
                )
            )
        )
    )
    integrand = np.where(
        small,
        (r**2) * x * taylor_poly,
        (np.sin(x_safe) - x_safe * np.cos(x_safe)) / (k_safe**2),
    )
    vol = 4.0 * math.pi * a * float(np.sum(w * integrand))
    return area, vol


def warped_varying_R_ball_area_vol(
    r: float, c3: float = -1.0 / 6.0, c5: float = 0.1
) -> tuple[float, float]:
    """Гладкое 3-многообразие ds^2 = dr^2 + f(r)^2 dOmega_2^2 с переменной R(r)."""
    r2 = r * r
    f = r * (1.0 + r2 * (c3 + c5 * r2))
    area = 4.0 * math.pi * (f * f)
    vol = (
        4.0
        * math.pi
        * (r**3)
        * (
            1.0 / 3.0
            + r2 * (
                2.0 * c3 / 5.0
                + r2 * (
                    (c3 * c3 + 2.0 * c5) / 7.0
                    + r2 * (2.0 * c3 * c5 / 9.0 + (c5 * c5) * r2 / 11.0)
                )
            )
        )
    )
    return area, vol


def warped_varying_scalar_curvature(
    r: float, c3: float = -1.0 / 6.0, c5: float = 0.1
) -> float:
    if r == 0.0:
        return -36.0 * c3
    r2 = r * r
    f = r * (1.0 + r2 * (c3 + c5 * r2))
    fp_minus_1 = r2 * (3.0 * c3 + 5.0 * c5 * r2)
    fpp = r * (6.0 * c3 + 20.0 * c5 * r2)
    one_minus_fp2 = -fp_minus_1 * (2.0 + fp_minus_1)
    return 2.0 * (-2.0 * fpp / f + one_minus_fp2 / (f * f))


# =============================================================================
# Полный набор 20 верификационных тестов AEFH v7.0
# =============================================================================


class TestAEFHv7MasterSuite(unittest.TestCase):
    # -------------------------------------------------------------------------
    # Блок I. Алгебраическая устойчивость и причинность (Теоремы 1-4)
    # -------------------------------------------------------------------------

    def test_01_theorem01_hessians_and_quartic_critical_point(self) -> None:
        rng = np.random.default_rng(42)
        N = 6
        eps = 1e-4

        sigma = random_state(rng, N, shift=0.5)
        H = rng.standard_normal((N, N)) + 1j * rng.standard_normal((N, N))
        drho = 0.5 * (H + H.conj().T)
        drho -= tr_norm(drho) * np.eye(N)
        drho /= np.linalg.norm(drho)

        d2_S_num = (
            rel_entropy(sigma + eps * drho, sigma)
            - 2.0 * rel_entropy(sigma, sigma)
            + rel_entropy(sigma - eps * drho, sigma)
        ) / (eps**2)
        d2_H_num = (
            (1.0 - affinity_p(sigma + eps * drho, sigma, 0.5))
            - 2.0 * (1.0 - affinity_p(sigma, sigma, 0.5))
            + (1.0 - affinity_p(sigma - eps * drho, sigma, 0.5))
        ) / (eps**2)

        g_bkm, g_h = analytical_hessians(sigma, drho)
        self.assertLess(abs(d2_S_num - g_bkm), 1e-6)
        self.assertLess(abs(d2_H_num - g_h), 1e-6)
        self.assertGreater(g_bkm / g_h, 4.0)

        _, vecs = np.linalg.eigh(sigma)
        d_diag = np.linspace(-1.0, 1.0, N)
        d_diag -= d_diag.mean()
        drho_comm = (vecs * d_diag) @ vecs.conj().T
        g_bkm_c, g_h_c = analytical_hessians(sigma, drho_comm)
        self.assertAlmostEqual(g_bkm_c / g_h_c, 4.0, places=12)
        self.assertGreater(g_bkm_c - 3.95 * g_h_c, 0.0)
        self.assertLess(g_bkm_c - 4.05 * g_h_c, 0.0)

        # Контроль тождества отношения ядер при r = sqrt(a / b).
        a, b = 4.0, 1.0
        r = math.sqrt(a / b)
        ratio_direct = ((math.log(a) - math.log(b)) / (a - b)) * (math.sqrt(a) + math.sqrt(b)) ** 2
        ratio_r = 2.0 * (r + 1.0) * math.log(r) / (r - 1.0)
        self.assertAlmostEqual(ratio_direct, ratio_r, places=14)
        self.assertAlmostEqual(ratio_r, 6.0 * math.log(2.0), places=14)

        I2 = np.eye(2)
        for t in (0.1, 0.03, 0.01):
            rho_t = np.diag([1.0 + t, 1.0 - t])
            j4 = rel_entropy(rho_t, I2) - 4.0 * (1.0 - affinity_p(rho_t, I2, 0.5))
            expected = -(7.0 / 96.0) * (t**4)
            self.assertLess(j4, 0.0)
            self.assertLess(abs(j4 - expected) / abs(expected), 0.01)

    def test_02_theorem02_global_bound_and_2d_free_vacuum(self) -> None:
        rng = np.random.default_rng(123)
        N = 6
        for _ in range(300):
            r1 = random_state(rng, N, shift=1e-3)
            r2 = random_state(rng, N, shift=1e-3)
            s_val = rel_entropy(r1, r2)
            f_val = affinity_p(r1, r2, 0.5)
            renyi_half = -2.0 * math.log(f_val)
            hellinger_2 = 2.0 * (1.0 - f_val)
            self.assertGreaterEqual(s_val - renyi_half, -1e-12)
            self.assertGreaterEqual(renyi_half - hellinger_2, -1e-12)

        p, eps = 1e-4, 1e-16
        s_2d = 0.5 * eps * math.log(eps / (2.0 * p)) + (1.0 - 0.5 * eps) * (
            math.log1p(-0.5 * eps) - math.log1p(-p)
        )
        one_minus_f_2d = -math.expm1(
            0.5 * (math.log1p(-0.5 * eps) + math.log1p(-p))
        ) - 0.5 * math.sqrt(2.0 * p * eps)
        ratio_2d = s_2d / one_minus_f_2d
        self.assertGreater(ratio_2d, 2.0)
        self.assertLess(ratio_2d, 2.0001)

    def test_03_theorem03_exact_finite_dim_threshold(self) -> None:
        for bad_dim in (1, 0, -1):
            self.assertRaises(ValueError, exact_gamma_n, bad_dim)

        dims = (2, 10, 100, 1000, 10000, 10**8)
        gammas = [exact_gamma_n(d) for d in dims]
        for prev, curr in zip(gammas, gammas[1:]):
            self.assertGreater(prev, curr)
        self.assertAlmostEqual(gammas[0], math.log(2.0) / (1.0 - 1.0 / math.sqrt(2.0)), places=12)
        self.assertAlmostEqual(gammas[2], 2.005029, places=5)
        self.assertGreater(gammas[-1], 2.0)
        for dim, g_val in zip(dims[-3:], gammas[-3:]):
            asymp = 1.0 / (2.0 * dim)
            self.assertLess(abs((g_val - 2.0) - asymp) / asymp, 1e-2)

        # Регрессия квадратичного коэффициента: gamma_N = 2 + 1/(2N) + 7/(24N^2) + O(N^-3).
        asymptotic_dim = 10_000
        x = 1.0 / asymptotic_dim
        quadratic_coefficient = (exact_gamma_n(asymptotic_dim) - 2.0 - x / 2.0) / (x * x)
        self.assertAlmostEqual(quadratic_coefficient, 7.0 / 24.0, delta=5e-5)

        dim_lim = 5
        g_target = exact_gamma_n(dim_lim)
        prev_gap = float("inf")
        for eps_val in (1e-2, 1e-4, 1e-6, 1e-9, 1e-12):
            high = (dim_lim - eps_val) / (dim_lim - 1)
            s_v = (eps_val * math.log(eps_val) + (dim_lim - 1) * high * math.log(high)) / dim_lim
            f_v = (math.sqrt(eps_val) + (dim_lim - 1) * math.sqrt(high)) / dim_lim
            gap = (s_v / (1.0 - f_v)) - g_target
            self.assertGreater(gap, 0.0)
            self.assertLess(gap, prev_gap)
            prev_gap = gap
        self.assertLess(prev_gap, 1e-5)

        rng = np.random.default_rng(2026)
        for dim in (2, 3, 5, 10):
            g_n = exact_gamma_n(dim)
            u_star = (g_n / 4.0) ** 2
            self.assertGreater(u_star, 0.25)
            self.assertLess(u_star, 4.0 / 9.0)

            for k in range(1, dim):
                lr_k = math.log1p(-k / dim)
                gamma_k = (-lr_k) / (-math.expm1(0.5 * lr_k))
                if k == 1:
                    self.assertAlmostEqual(gamma_k, g_n, places=14)
                else:
                    self.assertGreater(gamma_k, g_n)

            a_sub = np.linspace(1e-4, u_star * (1.0 - 1e-4), 300)
            b_sub = (dim - a_sub) / (dim - 1.0)
            h3 = lambda u: (3.0 * g_n - 8.0 * np.sqrt(u)) / (8.0 * (u**2.5))
            self.assertTrue(np.all(h3(a_sub) - h3(b_sub) / ((dim - 1.0) ** 2) > 0.0))

            a_full = np.linspace(1e-4, 1.0 - 1e-4, 500)
            b_full = (dim - a_full) / (dim - 1.0)
            h_fn = lambda u: u * np.log(u) + g_n * np.sqrt(u) - g_n * u
            self.assertTrue(np.all(h_fn(a_full) + (dim - 1.0) * h_fn(b_full) > 0.0))

            # 600 случайных спектров на размерность (3 x 200 Дирихле)
            for alpha_dir in (0.05, 0.5, 2.0):
                samples = rng.dirichlet(np.full(dim, alpha_dir), size=200) * dim
                for u in samples:
                    pos = u > 0.0
                    s_val = float(np.sum(u[pos] * np.log(u[pos])) / dim)
                    one_minus_f = float(1.0 - np.sum(np.sqrt(u)) / dim)
                    self.assertGreaterEqual(s_val - g_n * one_minus_f, -1e-13)

    def test_04a_theorem04_petz_operator_inequality_direct(self) -> None:
        rng = np.random.default_rng(31415)
        N, K = 6, 3
        for _ in range(15):
            rho = random_state(rng, N)
            sigma = random_state(rng, N)
            kraus = random_tau_channel_kraus(rng, N, K, num_kraus=4)

            phi_rho = apply_tau_channel(kraus, rho)
            phi_sigma = apply_tau_channel(kraus, sigma)
            self.assertAlmostEqual(tr_norm(phi_rho), 1.0, places=12)
            self.assertAlmostEqual(tr_norm(phi_sigma), 1.0, places=12)
            self.assertLess(
                np.linalg.norm(apply_tau_adjoint(kraus, np.eye(K)) - np.eye(N)), 1e-12
            )

            sigma_sqrt = mat_func(sigma, np.sqrt)
            phi_sigma_inv_sqrt = mat_func(phi_sigma, lambda x: 1.0 / np.sqrt(x))
            M_V = np.zeros((N * N, K * K), dtype=complex)
            scale_basis = math.sqrt(K / N)
            for a in range(K):
                for b in range(K):
                    E_ab = np.zeros((K, K), dtype=complex)
                    E_ab[a, b] = 1.0
                    img = apply_tau_adjoint(kraus, E_ab @ phi_sigma_inv_sqrt) @ sigma_sqrt
                    M_V[:, a * K + b] = scale_basis * img.reshape(-1)

            self.assertGreaterEqual(
                float(np.linalg.eigvalsh(np.eye(K * K) - M_V.conj().T @ M_V).min()), -1e-12
            )

            v_in = mat_func(phi_sigma, np.sqrt).reshape(-1) / math.sqrt(K)
            v_expected = sigma_sqrt.reshape(-1) / math.sqrt(N)
            self.assertLess(float(np.linalg.norm(M_V @ v_in - v_expected)), 1e-12)

            D_in = np.kron(rho, mat_func(sigma, lambda x: 1.0 / x).T)
            D_out = np.kron(phi_rho, mat_func(phi_sigma, lambda x: 1.0 / x).T)
            diff_mod = D_out - M_V.conj().T @ D_in @ M_V
            diff_mod = 0.5 * (diff_mod + diff_mod.conj().T)
            self.assertGreaterEqual(float(np.linalg.eigvalsh(diff_mod).min()), -1e-11)

            for p in (0.25, 0.5, 0.75):
                self.assertGreaterEqual(
                    affinity_p(phi_rho, phi_sigma, p) - affinity_p(rho, sigma, p), -1e-12
                )

    def test_04b_theorem04_dpi_three_physical_channels(self) -> None:
        rng = np.random.default_rng(27182)
        P1 = np.diag([1.0, 1.0, 0.0, 0.0, 0.0, 0.0])
        P2 = np.diag([0.0, 0.0, 1.0, 1.0, 1.0, 1.0])
        cond_exp = lambda X: P1 @ X @ P1 + P2 @ X @ P2
        partial_tau_b = lambda X: np.trace(X.reshape(2, 3, 2, 3), axis1=1, axis2=3) / 3.0
        kraus = random_tau_channel_kraus(rng, 6, 3, num_kraus=5)
        general_ch = lambda X: apply_tau_channel(kraus, X)

        for name, ch in (
            ("conditional_expectation", cond_exp),
            ("normalized_partial_trace", partial_tau_b),
            ("general_nonunital_tau_channel", general_ch),
        ):
            for _ in range(30):
                rho = random_state(rng, 6, shift=0.1)
                sigma = random_state(rng, 6, shift=0.1)
                pr, ps = ch(rho), ch(sigma)

                s_in, s_out = rel_entropy(rho, sigma), rel_entropy(pr, ps)
                h_in = 1.0 - affinity_p(rho, sigma, 0.5)
                h_out = 1.0 - affinity_p(pr, ps, 0.5)

                self.assertLessEqual(s_out, s_in + 1e-12, msg=name)
                self.assertLessEqual(h_out, h_in + 1e-12, msg=name)
                for alpha in (0.0, 0.5, 2.0, 10.0):
                    self.assertLessEqual(s_out + alpha * h_out, s_in + alpha * h_in + 1e-12)

    def test_04c_theorem04_dpi_failure_for_any_positive_gamma(self) -> None:
        I3 = np.eye(3)
        S12 = np.array([[0.0, 1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]])
        phi_swap = lambda X: 0.5 * (X + S12 @ X @ S12)

        for gamma in (10.0, 1.5, 0.5, 0.05):
            critical = gamma * (2.0 - math.sqrt(2.0)) / (2.0 * math.log(2.0))
            sqrt_m = 0.5 * min(1.0, critical)
            m = sqrt_m**2
            eps = 1e-12 * m
            self.assertGreater(3.0 - 2.0 * m, 0.0)

            rho = np.diag([eps, 2.0 * m - eps, 3.0 - 2.0 * m])
            phi_rho = phi_swap(rho)
            j_in = rel_entropy(rho, I3) - gamma * (1.0 - affinity_p(rho, I3, 0.5))
            j_out = rel_entropy(phi_rho, I3) - gamma * (1.0 - affinity_p(phi_rho, I3, 0.5))
            delta_j_num = j_out - j_in
            delta_j_exact = (sqrt_m / 3.0) * (
                gamma * (2.0 - math.sqrt(2.0)) - 2.0 * math.log(2.0) * sqrt_m
            )
            self.assertGreater(delta_j_num, 0.0, msg=f"gamma={gamma}")
            self.assertLess(abs(delta_j_num - delta_j_exact) / delta_j_exact, 1e-5)

        with localcontext() as ctx:
            ctx.prec = 60
            d1, d2, d3 = Decimal(1), Decimal(2), Decimal(3)
            sqrt2, ln2 = d2.sqrt(), d2.ln()
            for gamma_str in ("1e-4", "1e-8"):
                g = Decimal(gamma_str)
                crit = g * (d2 - sqrt2) / (d2 * ln2)
                sm = Decimal("0.5") * min(d1, crit)
                m = sm * sm
                eps = Decimal("1e-12") * m
                u1, u2, u3 = eps, d2 * m - eps, d3 - d2 * m

                s_in = (u1 * u1.ln() + u2 * u2.ln() + u3 * u3.ln()) / d3
                s_out = (d2 * m * m.ln() + u3 * u3.ln()) / d3
                f_in = (u1.sqrt() + u2.sqrt() + u3.sqrt()) / d3
                f_out = (d2 * sm + u3.sqrt()) / d3

                delta_num = (s_out - g * (d1 - f_out)) - (s_in - g * (d1 - f_in))
                delta_exact = (sm / d3) * (g * (d2 - sqrt2) - d2 * ln2 * sm)
                self.assertGreater(delta_num, 0)
                self.assertLess(abs(delta_num - delta_exact) / delta_exact, Decimal("1e-5"))

        for N, K in ((2, 2), (3, 2), (5, 2), (3, 4)):
            sigma = np.eye(N)
            for gamma in (10.0, 1.5, 0.5, 0.05):
                x = min(1e-4, (gamma / 200.0) ** 2)
                t = 0.5 * x
                rho = np.diag([x] + [(N - x) / (N - 1)] * (N - 1))

                def theta(X: np.ndarray) -> np.ndarray:
                    d = np.diag(X).real
                    tail = float(np.sum(d[1:])) / (K - 1)
                    return (K / N) * np.diag([float(d[0])] + [tail] * (K - 1))

                phi_sigma = theta(sigma)
                th_rho = theta(rho)
                phi_rho = (1.0 - t) * th_rho + t * tr_norm(th_rho) * phi_sigma

                self.assertAlmostEqual(tr_norm(phi_sigma), 1.0, places=14)
                self.assertAlmostEqual(tr_norm(phi_rho), 1.0, places=14)
                j_in = rel_entropy(rho, sigma) - gamma * (1.0 - affinity_p(rho, sigma, 0.5))
                j_out = rel_entropy(phi_rho, phi_sigma) - gamma * (
                    1.0 - affinity_p(phi_rho, phi_sigma, 0.5)
                )
                self.assertGreater(j_out - j_in, 1e-8)

    # -------------------------------------------------------------------------
    # Блок II. Геометрия Эйнштейна и космология DESI (Теорема 5, Сл. 5.1-5.2)
    # -------------------------------------------------------------------------

    def test_05a_theorem05_geodesic_ball_O_l6_all_manifolds(self) -> None:
        a = 1.0
        radii = (0.08, 0.04, 0.02)
        c3, c5 = -1.0 / 6.0, 0.1
        R0_warped = warped_varying_scalar_curvature(0.0, c3, c5)
        self.assertGreater(abs(warped_varying_scalar_curvature(0.2, c3, c5) - R0_warped), 0.3)

        manifolds = (
            (
                "S^3",
                6.0 / (a**2),
                lambda r: (
                    4.0 * math.pi * (a**2) * (math.sin(r / a) ** 2),
                    math.pi * (a**3) * z_minus_sin(2.0 * r / a),
                ),
            ),
            (
                "H^3",
                -6.0 / (a**2),
                lambda r: (
                    4.0 * math.pi * (a**2) * (math.sinh(r / a) ** 2),
                    math.pi * (a**3) * sinh_minus_z(2.0 * r / a),
                ),
            ),
            ("S^2 x R", 2.0 / (a**2), lambda r: s2_x_r_ball_area_vol(r, a)),
            ("Warped varying-R", R0_warped, lambda r: warped_varying_R_ball_area_vol(r, c3, c5)),
        )

        for name, R_origin, av_fn in manifolds:
            abs_remainders = []
            for l0 in radii:
                V_flat = (4.0 / 3.0) * math.pi * (l0**3)
                A_flat = 4.0 * math.pi * (l0**2)
                r = l0
                for _ in range(15):
                    A_r, V_r = av_fn(r)
                    r -= (V_r - V_flat) / A_r
                A_eq, V_eq = av_fn(r)
                self.assertLess(abs(V_eq - V_flat) / V_flat, 1e-12, msg=name)

                dA_num = A_eq - A_flat
                dA_lead = -(2.0 * math.pi * (l0**4) / 15.0) * R_origin
                rem = abs(dA_num - dA_lead)
                self.assertLess(rem / abs(dA_lead), 1e-2, msg=name)
                if l0 == 0.02:
                    self.assertLess(rem / abs(dA_lead), 1e-3, msg=name)
                abs_remainders.append(rem)

            order_coarse = math.log2(abs_remainders[0] / abs_remainders[1])
            order_fine = math.log2(abs_remainders[1] / abs_remainders[2])
            self.assertTrue(5.85 < order_coarse < 6.15, msg=f"{name}: {order_coarse:.4f}")
            self.assertTrue(5.92 < order_fine < 6.08, msg=f"{name}: {order_fine:.4f}")

    def test_05b_corollaries5_1_and_5_2_flrw_and_illustrative_coupled_quintessence(self) -> None:
        # Часть 1 (Следствие 5.1): несвязанная квинтэссенция (beta = 0), связь Фридмана
        V0, lam = 0.7, 0.8
        rho_m, phi, dphi = 0.3, 0.0, 0.15
        V = lambda p: V0 * math.exp(-lam * p)
        dV = lambda p: -lam * V0 * math.exp(-lam * p)

        H = math.sqrt((rho_m + 0.5 * (dphi**2) + V(phi)) / 3.0)
        y = np.array([H, rho_m, phi, dphi], dtype=float)

        def rhs_uncoupled(state: np.ndarray) -> np.ndarray:
            H_, rm_, p_, dp_ = state
            return np.array(
                [-0.5 * (rm_ + dp_**2), -3.0 * H_ * rm_, dp_, -3.0 * H_ * dp_ - dV(p_)],
                dtype=float,
            )

        dt = 1e-3
        max_err = 0.0
        rho_phi_prev = 0.5 * (dphi**2) + V(phi)
        for _ in range(2000):
            k1 = rhs_uncoupled(y)
            k2 = rhs_uncoupled(y + 0.5 * dt * k1)
            k3 = rhs_uncoupled(y + 0.5 * dt * k2)
            k4 = rhs_uncoupled(y + dt * k3)
            y = y + (dt / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)

            H_, rm_, p_, dp_ = y
            rho_phi = 0.5 * (dp_**2) + V(p_)
            w_phi = (0.5 * (dp_**2) - V(p_)) / rho_phi
            max_err = max(max_err, abs(3.0 * (H_**2) - (rm_ + rho_phi)))
            self.assertLessEqual(rho_phi, rho_phi_prev + 1e-14)
            self.assertGreater(w_phi, -1.0)
            self.assertLess(w_phi, 1.0)
            rho_phi_prev = rho_phi
        self.assertLess(max_err, 1e-12)

        # Часть 2 (Следствие 5.2): иллюстративная связанная тающая квинтэссенция.
        # beta=-0.05 — выбранный масштаб связи, не результат likelihood-fit к DESI.
        # Истинное поле без призраков (w_phi >= -1), но эффективное w_eff пересекает -1!
        V0_c, lam_c, beta_c = 0.7, 1.2, -0.05
        Vc = lambda p: V0_c * math.exp(-lam_c * p)
        dVc = lambda p: -lam_c * V0_c * math.exp(-lam_c * p)

        rm0, phi0, dphi0, a0 = 2.0, 0.0, 0.0, 1.0
        H0 = math.sqrt((rm0 + 0.5 * (dphi0**2) + Vc(phi0)) / 3.0)
        yc = np.array([H0, rm0, phi0, dphi0, a0], dtype=float)
        inv0 = (a0**3) * rm0 * math.exp(beta_c * phi0)

        def rhs_coupled(state: np.ndarray) -> np.ndarray:
            H_, rm_, p_, dp_, a_ = state
            return np.array(
                [
                    -0.5 * (rm_ + dp_**2),
                    -3.0 * H_ * rm_ - beta_c * dp_ * rm_,
                    dp_,
                    -3.0 * H_ * dp_ - dVc(p_) + beta_c * rm_,
                    H_ * a_,
                ],
                dtype=float,
            )

        traj = [yc.copy()]
        max_friedmann_c = 0.0
        max_inv_err = 0.0
        for _ in range(1000):
            k1 = rhs_coupled(yc)
            k2 = rhs_coupled(yc + 0.5 * dt * k1)
            k3 = rhs_coupled(yc + 0.5 * dt * k2)
            k4 = rhs_coupled(yc + dt * k3)
            yc = yc + (dt / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)
            traj.append(yc.copy())

            H_, rm_, p_, dp_, a_ = yc
            rho_p = 0.5 * (dp_**2) + Vc(p_)
            w_true = (0.5 * (dp_**2) - Vc(p_)) / rho_p
            self.assertGreaterEqual(w_true, -1.0 - 1e-15)  # Строго без призраков!
            self.assertLess(w_true, 1.0)
            max_friedmann_c = max(max_friedmann_c, abs(3.0 * (H_**2) - (rm_ + rho_p)))
            inv_now = (a_**3) * rm_ * math.exp(beta_c * p_)
            max_inv_err = max(max_inv_err, abs(inv_now - inv0) / inv0)

        self.assertLess(max_friedmann_c, 1e-12)
        self.assertLess(max_inv_err, 1e-11)

        # Нормируем масштабный фактор на "сегодня" (a_today = 1) и считаем w_eff(t)
        a_today = traj[-1][4]
        rm_today = traj[-1][1]
        w_eff_series = []
        for state in traj:
            H_, rm_, p_, dp_, a_ = state
            a_rel = a_ / a_today
            rho_p = 0.5 * (dp_**2) + Vc(p_)
            delta_rm = rm_ - rm_today * (a_rel ** (-3))
            rho_de_eff = rho_p + delta_rm
            self.assertGreater(rho_de_eff, 0.0)
            w_eff = -1.0 + (dp_**2 + delta_rm) / rho_de_eff
            w_eff_series.append(w_eff)

        # Кажущийся переход через фантомный барьер: w_eff < -1 в прошлом, w_eff > -1 сегодня
        self.assertLess(w_eff_series[0], -1.01)
        self.assertGreater(w_eff_series[-1], -0.98)

    # -------------------------------------------------------------------------
    # Блок III. Калибровочный сектор, краевые моды и Янг - Миллс (Теоремы 6-8)
    # -------------------------------------------------------------------------

    def test_06_theorem06_center_splitting_of_I_alpha(self) -> None:
        rng = np.random.default_rng(6001)
        sector_dims = (2, 3, 4)
        total_dim = sum(sector_dims)
        weights = [d / total_dim for d in sector_dims]

        for _ in range(20):
            p = rng.dirichlet(np.ones(len(sector_dims)))
            r = rng.dirichlet(np.ones(len(sector_dims)))
            rho_hats = [random_state(rng, d) for d in sector_dims]
            sig_hats = [random_state(rng, d) for d in sector_dims]

            rho_full = block_diag([(pq / wq) * rh for pq, wq, rh in zip(p, weights, rho_hats)])
            sig_full = block_diag([(rq / wq) * sh for rq, wq, sh in zip(r, weights, sig_hats)])
            self.assertAlmostEqual(tr_norm(rho_full), 1.0, places=13)
            self.assertAlmostEqual(tr_norm(sig_full), 1.0, places=13)

            s_full = rel_entropy(rho_full, sig_full)
            h_full = 1.0 - affinity_p(rho_full, sig_full, 0.5)

            d_kl = float(np.sum(p * np.log(p / r)))
            s_bulk = sum(pq * rel_entropy(rh, sh) for pq, rh, sh in zip(p, rho_hats, sig_hats))
            h_edge = 1.0 - float(np.sum(np.sqrt(p * r)))
            h_bulk = sum(
                math.sqrt(pq * rq) * (1.0 - affinity_p(rh, sh, 0.5))
                for pq, rq, rh, sh in zip(p, r, rho_hats, sig_hats)
            )

            self.assertAlmostEqual(s_full, d_kl + s_bulk, places=12)
            self.assertAlmostEqual(h_full, h_edge + h_bulk, places=12)
            for alpha in (0.0, 0.7, 3.5):
                lhs = i_alpha(rho_full, sig_full, alpha)
                rhs = (d_kl + alpha * h_edge) + (s_bulk + alpha * h_bulk)
                self.assertAlmostEqual(lhs, rhs, places=12)

    def test_07_theorem07_gauss_gluing_and_nonabelian_edge_entropy(self) -> None:
        rng = np.random.default_rng(7001)
        omega = np.exp(2j * math.pi / 3.0)

        R_c = np.diag([omega, omega.conjugate()])
        S_c = np.array([[0.0, 1.0], [1.0, 0.0]], dtype=complex)
        I2 = np.eye(2, dtype=complex)
        s3_2d = [I2, R_c, R_c @ R_c, S_c, S_c @ R_c, S_c @ R_c @ R_c]
        s3_sign = [1.0, 1.0, 1.0, -1.0, -1.0, -1.0]
        s3_triv = [1.0] * 6

        self.assertGreater(np.linalg.norm(R_c.conj() - R_c), 1.0)
        mult = 2
        I_m = np.eye(mult, dtype=complex)
        U_L_list = [
            block_diag([s3_triv[i] * I_m, s3_sign[i] * I_m, np.kron(I_m, s3_2d[i])])
            for i in range(6)
        ]
        U_R_list = [
            block_diag(
                [np.conj(s3_triv[i]) * I_m, np.conj(s3_sign[i]) * I_m, np.kron(I_m, s3_2d[i].conj())]
            )
            for i in range(6)
        ]

        P_G = sum(np.kron(uL, uR) for uL, uR in zip(U_L_list, U_R_list)) / 6.0
        self.assertLess(np.linalg.norm(P_G - P_G.conj().T), 1e-13)
        self.assertLess(np.linalg.norm(P_G @ P_G - P_G), 1e-13)
        self.assertAlmostEqual(float(np.trace(P_G).real), 12.0, places=12)

        phi_phys = P_G @ (rng.standard_normal(64) + 1j * rng.standard_normal(64))
        phi_phys /= np.linalg.norm(phi_phys)
        psi_mat = phi_phys.reshape(8, 8)
        rho_L = psi_mat @ psi_mat.conj().T

        for uL in U_L_list:
            self.assertLess(np.linalg.norm(rho_L @ uL - uL @ rho_L), 1e-13)

        probs, bulk_entropies, edge_dims = [], [], []
        for s0, s1, d_q in ((0, 2, 1), (2, 4, 1), (4, 8, 2)):
            blk = rho_L[s0:s1, s0:s1]
            p_q = float(np.trace(blk).real)
            self.assertGreater(p_q, 1e-4)
            probs.append(p_q)
            edge_dims.append(d_q)
            if d_q == 1:
                rho_bulk = blk / p_q
            else:
                rho_bulk = np.trace((blk / p_q).reshape(mult, d_q, mult, d_q), axis1=1, axis2=3)
                reconstructed = p_q * np.kron(rho_bulk, np.eye(d_q) / d_q)
                self.assertLess(np.linalg.norm(blk - reconstructed), 1e-13)
            bulk_entropies.append(vn_entropy(rho_bulk))

        h_shannon = -sum(pq * math.log(pq) for pq in probs)
        s_dim = sum(pq * math.log(dq) for pq, dq in zip(probs, edge_dims))
        s_dist = sum(pq * sb for pq, sb in zip(probs, bulk_entropies))
        self.assertGreater(s_dim, 0.05)
        self.assertAlmostEqual(vn_entropy(rho_L), h_shannon + s_dim + s_dist, places=12)

        # Абелева группа Z_3: S_dim == 0, остаётся H(p) + S_dist
        z3_chars = [[1.0, 1.0, 1.0], [1.0, omega, omega**2], [1.0, omega**2, omega]]
        U_L_z3 = [block_diag([z3_chars[q][g] * I_m for q in range(3)]) for g in range(3)]
        U_R_z3 = [block_diag([np.conj(z3_chars[q][g]) * I_m for q in range(3)]) for g in range(3)]
        P_Z3 = sum(np.kron(uL, uR) for uL, uR in zip(U_L_z3, U_R_z3)) / 3.0
        v_ab = P_Z3 @ (rng.standard_normal(36) + 1j * rng.standard_normal(36))
        v_ab /= np.linalg.norm(v_ab)
        rho_L_ab = v_ab.reshape(6, 6) @ v_ab.reshape(6, 6).conj().T
        p_ab = [float(np.trace(rho_L_ab[2 * q : 2 * q + 2, 2 * q : 2 * q + 2]).real) for q in range(3)]
        s_ab_dist = sum(
            p_ab[q] * vn_entropy(rho_L_ab[2 * q : 2 * q + 2, 2 * q : 2 * q + 2] / p_ab[q])
            for q in range(3)
        )
        h_ab = -sum(pq * math.log(pq) for pq in p_ab)
        self.assertAlmostEqual(vn_entropy(rho_L_ab), h_ab + s_ab_dist, places=12)

    def test_08a_theorem08_exact_haar_clifford_2design_and_u3_mc(self) -> None:
        rng = np.random.default_rng(8001)
        clifford = clifford_1qubit_2design()
        self.assertEqual(len(clifford), 24)

        sigma0_2 = random_state(rng, 2, shift=0.3)
        W2 = haar_unitary(rng, 2)
        for alpha in (0.0, 1.25, 4.0):
            avg_2d = sum(
                i_alpha(
                    W2 @ (V @ sigma0_2 @ V.conj().T) @ W2.conj().T,
                    V @ sigma0_2 @ V.conj().T,
                    alpha,
                )
                for V in clifford
            ) / len(clifford)
            theory = kappa_alpha_exact(sigma0_2, alpha) * one_minus_tau_adj(W2)
            self.assertAlmostEqual(avg_2d, theory, places=12)
            self.assertAlmostEqual(
                kappa_alpha_exact(sigma0_2, alpha) * one_minus_tau_adj(np.exp(0.73j) * W2),
                theory,
                places=13,
            )

        sigma0_3 = random_state(rng, 3, shift=0.2)
        log_s0 = mat_func(sigma0_3, np.log)
        sqrt_s0 = mat_func(sigma0_3, np.sqrt)
        s0_ln_s0 = tr_norm(sigma0_3 @ log_s0)
        W3 = haar_unitary(rng, 3)
        alpha_3 = 1.5

        acc = 0.0
        n_samples = 4000
        for _ in range(n_samples):
            V = haar_unitary(rng, 3)
            U = V.conj().T @ W3 @ V
            acc += (s0_ln_s0 - tr_norm(U @ sigma0_3 @ U.conj().T @ log_s0)) + alpha_3 * (
                1.0 - tr_norm(U @ sqrt_s0 @ U.conj().T @ sqrt_s0)
            )
        mc_mean = acc / n_samples
        theory_3 = kappa_alpha_exact(sigma0_3, alpha_3) * one_minus_tau_adj(W3)
        self.assertLess(abs(mc_mean - theory_3), 0.025)

    def test_08b_theorem08_su3_yang_mills_continuum_and_O_a6(self) -> None:
        rng = np.random.default_rng(8002)
        T1 = 0.5 * np.array([[0, 1, 0], [1, 0, 0], [0, 0, 0]], dtype=complex)
        T2 = 0.5 * np.array([[0, -1j, 0], [1j, 0, 0], [0, 0, 0]], dtype=complex)
        T4 = 0.5 * np.array([[0, 0, 1], [0, 0, 0], [1, 0, 0]], dtype=complex)
        T6 = 0.5 * np.array([[0, 0, 0], [0, 0, 1], [0, 1, 0]], dtype=complex)

        A1 = lambda x, y: (0.6 + 0.4 * y + 0.3 * x * x) * T1 + (0.5 - 0.3 * x + 0.2 * y * y) * T4
        A2 = lambda x, y: (0.7 + 0.5 * x + 0.25 * y * y) * T2 + (0.4 + 0.35 * y - 0.2 * x * x) * T6

        def plaquette(x0: float, y0: float, a: float) -> np.ndarray:
            return (
                mat_expm_iherm(a * A1(x0, y0 - 0.5 * a))
                @ mat_expm_iherm(a * A2(x0 + 0.5 * a, y0))
                @ mat_expm_iherm(a * A1(x0, y0 + 0.5 * a)).conj().T
                @ mat_expm_iherm(a * A2(x0 - 0.5 * a, y0)).conj().T
            )

        x0, y0 = 0.2, -0.15
        d2_A1 = 0.4 * T1 + (0.4 * y0) * T4
        d1_A2 = 0.5 * T2 - (0.4 * x0) * T6
        F12 = d1_A2 - d2_A1 + 1j * (A1(x0, y0) @ A2(x0, y0) - A2(x0, y0) @ A1(x0, y0))
        tr_F2 = float(np.trace(F12 @ F12).real)

        sigma0 = random_state(rng, 3, shift=0.25)
        kappa = kappa_alpha_exact(sigma0, alpha=1.5)
        inv_g_ym_sq = (3.0 * kappa) / 8.0

        a_chk = 0.1
        W_pos = plaquette(x0, y0, a_chk)
        self.assertAlmostEqual(
            one_minus_tau_adj(W_pos), one_minus_tau_adj(plaquette(x0, y0, -a_chk)), places=13
        )
        g1, g2, g3, g4 = [haar_unitary(rng, 3) for _ in range(4)]
        U1 = mat_expm_iherm(a_chk * A1(x0, y0 - 0.5 * a_chk))
        U2 = mat_expm_iherm(a_chk * A2(x0 + 0.5 * a_chk, y0))
        U3 = mat_expm_iherm(a_chk * A1(x0, y0 + 0.5 * a_chk))
        U4 = mat_expm_iherm(a_chk * A2(x0 - 0.5 * a_chk, y0))
        W_g = (
            (g1 @ U1 @ g2.conj().T)
            @ (g2 @ U2 @ g3.conj().T)
            @ (g4 @ U3 @ g3.conj().T).conj().T
            @ (g1 @ U4 @ g4.conj().T).conj().T
        )
        self.assertAlmostEqual(one_minus_tau_adj(W_g), one_minus_tau_adj(W_pos), places=13)

        rems = []
        for a in (0.16, 0.08, 0.04):
            s_plaq = kappa * one_minus_tau_adj(plaquette(x0, y0, a))
            s_lead = (a**4) * inv_g_ym_sq * tr_F2
            rem = abs(s_plaq - s_lead)
            self.assertLess(rem / s_lead, 2e-2)
            rems.append(rem)
        self.assertTrue(5.85 < math.log2(rems[0] / rems[1]) < 6.15)
        self.assertTrue(5.92 < math.log2(rems[1] / rems[2]) < 6.08)

    # -------------------------------------------------------------------------
    # Блок IV. Фундаментальные заряды, U(1), CP^N и Хиггс (Теоремы 9-11)
    # -------------------------------------------------------------------------

    def test_09a_theorem09_fundamental_adjoint_exact_2design_center_and_exotic_probe(self) -> None:
        rng = np.random.default_rng(9001)

        sig_u1 = random_state(rng, 2, shift=0.2)
        Z_u1 = np.diag([1.0, -1.0])
        for alpha in (0.0, 1.5, 4.0):
            kf, ka = fund_adj_kappas(sig_u1, alpha)
            self.assertEqual(ka, 0.0)
            self.assertAlmostEqual(kf, 0.5 * i_alpha(Z_u1 @ sig_u1 @ Z_u1, sig_u1, alpha), places=13)
            for theta in (0.37, 1.85, math.pi):
                W_u1 = augment_unitary(np.array([[np.exp(1j * theta)]], dtype=complex))
                self.assertAlmostEqual(
                    i_alpha(W_u1 @ sig_u1 @ W_u1.conj().T, sig_u1, alpha),
                    kf * (1.0 - math.cos(theta)),
                    places=13,
                )

        clifford = clifford_1qubit_2design()
        sig_u2 = random_state(rng, 3, shift=0.2)
        Z_u2 = np.diag([1.0, 1.0, -1.0])
        W2 = haar_unitary(rng, 2)
        W2_aug = augment_unitary(W2)
        for alpha in (0.0, 1.25, 3.0):
            kf, ka = fund_adj_kappas(sig_u2, alpha)
            self.assertAlmostEqual(kf, 0.5 * i_alpha(Z_u2 @ sig_u2 @ Z_u2, sig_u2, alpha), places=12)
            avg_2d = sum(
                i_alpha(
                    W2_aug @ (augment_unitary(V) @ sig_u2 @ augment_unitary(V).conj().T) @ W2_aug.conj().T,
                    augment_unitary(V) @ sig_u2 @ augment_unitary(V).conj().T,
                    alpha,
                )
                for V in clifford
            ) / len(clifford)
            theory = kf * one_minus_re_tau(W2) + ka * one_minus_tau_adj(W2)
            self.assertAlmostEqual(avg_2d, theory, places=12)

            W_c_aug = augment_unitary(-np.eye(2, dtype=complex))
            self.assertAlmostEqual(
                i_alpha(W_c_aug @ sig_u2 @ W_c_aug.conj().T, sig_u2, alpha), 2.0 * kf, places=12
            )

        # Экзотический зонд: kappa_adj < 0, но физическая жёсткость C_SU(2) > 0
        sig_ex = np.array([[1.01, 0.0, 0.8], [0.0, 0.99, 0.0], [0.8, 0.0, 1.0]], dtype=complex)
        kf_ex, ka_ex = fund_adj_kappas(sig_ex, alpha=0.0)
        self.assertLess(ka_ex, 0.0)
        self.assertGreater(kf_ex / 4.0 + (2.0 / 3.0) * ka_ex, 0.1)

        # Когерентный зонд ранга 1, центр Z_3 и Haar-MC на U(3) (4000 выборок)
        mu0, theta0, alpha3 = 0.4, 0.55, 1.5
        psi0 = np.array([0.0, 0.0, math.sin(theta0), math.cos(theta0)], dtype=complex)
        sig_r1 = rank1_probe(psi0, mu0)
        lam_val = lambda_alpha_rank1(4, mu0, alpha3)
        kf_r1, ka_r1 = fund_adj_kappas(sig_r1, alpha3)
        self.assertAlmostEqual(
            kf_r1, 2.0 * lam_val * (math.sin(theta0) ** 2) * (math.cos(theta0) ** 2), places=13
        )
        self.assertAlmostEqual(ka_r1, (2.0 / 3.0) * lam_val * (math.sin(theta0) ** 4), places=13)

        W_z3 = augment_unitary(np.exp(2j * math.pi / 3.0) * np.eye(3, dtype=complex))
        self.assertAlmostEqual(
            i_alpha(W_z3 @ sig_r1 @ W_z3.conj().T, sig_r1, alpha3),
            kf_r1 * (1.0 - math.cos(2.0 * math.pi / 3.0)),
            places=12,
        )

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
        theory_3 = kf_r1 * one_minus_re_tau(W3) + ka_r1 * one_minus_tau_adj(W3)
        self.assertLess(abs(acc / n_mc - theory_3), 0.025)

    def test_09b_theorem09_u1_maxwell_and_u2_continuum_limit_O_a6(self) -> None:
        rng = np.random.default_rng(9002)
        x0, y0 = 0.2, -0.15
        spacings = (0.16, 0.08, 0.04)

        a1_u1 = lambda x, y: 0.5 - 0.35 * y + 0.2 * x * x - 0.4 * (y**3)
        a2_u1 = lambda x, y: 0.4 + 0.45 * x - 0.15 * y * y + 0.5 * (x**3)
        f12_u1 = (0.45 + 1.5 * x0 * x0) - (-0.35 - 1.2 * y0 * y0)
        kf_u1, _ = fund_adj_kappas(random_state(rng, 2, shift=0.25), alpha=1.2)

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
            rem_u1.append(abs(s_plaq - s_lead))
        self.assertTrue(5.85 < math.log2(rem_u1[0] / rem_u1[1]) < 6.15)
        self.assertTrue(5.92 < math.log2(rem_u1[1] / rem_u1[2]) < 6.08)

        I2 = np.eye(2, dtype=complex)
        T1 = 0.5 * np.array([[0, 1], [1, 0]], dtype=complex)
        T2 = 0.5 * np.array([[0, -1j], [1j, 0]], dtype=complex)
        T3 = 0.5 * np.array([[1, 0], [0, -1]], dtype=complex)

        A1_u2 = lambda x, y: (
            a1_u1(x, y) * I2
            + (0.5 + 0.3 * y + 0.2 * x * x) * T1
            + (0.4 - 0.25 * x + 0.15 * y * y) * T3
        )
        A2_u2 = lambda x, y: (
            a2_u1(x, y) * I2
            + (0.6 + 0.4 * x + 0.2 * y * y) * T2
            + (0.35 + 0.3 * y - 0.15 * x * x) * T1
        )

        def plaq_u2(a: float) -> np.ndarray:
            return (
                mat_expm_iherm(a * A1_u2(x0, y0 - 0.5 * a))
                @ mat_expm_iherm(a * A2_u2(x0 + 0.5 * a, y0))
                @ mat_expm_iherm(a * A1_u2(x0, y0 + 0.5 * a)).conj().T
                @ mat_expm_iherm(a * A2_u2(x0 - 0.5 * a, y0)).conj().T
            )

        F12_su = (
            (0.4 * T2 - 0.3 * x0 * T1)
            - (0.3 * T1 + 0.3 * y0 * T3)
            + 1j * (A1_u2(x0, y0) @ A2_u2(x0, y0) - A2_u2(x0, y0) @ A1_u2(x0, y0))
        )
        tr_Fsu2 = float(np.trace(F12_su @ F12_su).real)
        kf, ka = fund_adj_kappas(random_state(rng, 3, shift=0.25), alpha=1.5)
        c_su2 = kf / 4.0 + (2.0 / 3.0) * ka

        rem_u2 = []
        for a in spacings:
            W = plaq_u2(a)
            s_plaq = kf * one_minus_re_tau(W) + ka * one_minus_tau_adj(W)
            s_lead = (a**4) * (0.5 * kf * (f12_u1**2) + c_su2 * tr_Fsu2)
            rem_u2.append(abs(s_plaq - s_lead))
        self.assertTrue(5.85 < math.log2(rem_u2[0] / rem_u2[1]) < 6.15)
        self.assertTrue(5.92 < math.log2(rem_u2[1] / rem_u2[2]) < 6.08)

    def test_10a_theorem10_cpn_fubini_study_link_action_and_O_a4(self) -> None:
        rng = np.random.default_rng(10001)
        mu0, alpha = 0.35, 1.75

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

        A_field = lambda x: (
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
            return i_alpha(
                U_aug @ rank1_probe(psi_fn(x0 + 0.5 * a), mu0) @ U_aug.conj().T,
                rank1_probe(psi_fn(x0 - 0.5 * a), mu0),
                alpha,
            )

        self.assertAlmostEqual(link_action(0.08), link_action(-0.08), places=13)
        rems = [abs(link_action(a) - (a**2) * lam3 * fs_density) for a in (0.08, 0.04, 0.02)]
        self.assertTrue(3.90 < math.log2(rems[0] / rems[1]) < 4.10)
        self.assertTrue(3.95 < math.log2(rems[1] / rems[2]) < 4.05)

    def test_10b_theorem10_higgs_mechanism_spectrum_u2_and_u3(self) -> None:
        mu0, theta0, alpha = 0.35, 0.42, 1.4
        eps = 1e-4

        psi0 = np.array([0.0, math.sin(theta0), math.cos(theta0)], dtype=complex)
        sig0 = rank1_probe(psi0, mu0)
        lam3 = lambda_alpha_rank1(3, mu0, alpha)

        kf, ka = fund_adj_kappas(sig0, alpha)
        g_prime = 1.0 / math.sqrt(0.25 * kf)
        g_weak = 1.0 / math.sqrt(0.25 * kf + (2.0 / 3.0) * ka)

        # Точная исправленная формула v5.0.1: tan^2(theta_W) = 1 + (2/3) tan^2(theta_0)
        self.assertAlmostEqual(
            (g_prime / g_weak) ** 2, 1.0 + (2.0 / 3.0) * (math.tan(theta0) ** 2), places=12
        )

        s1 = np.array([[0, 1], [1, 0]], dtype=complex)
        s2 = np.array([[0, -1j], [1j, 0]], dtype=complex)
        s3 = np.array([[1, 0], [0, -1]], dtype=complex)
        I2 = np.eye(2, dtype=complex)
        basis_u2 = [0.5 * g_weak * s1, 0.5 * g_weak * s2, 0.5 * g_weak * s3, 0.5 * g_prime * I2]

        def f_mass_u2(v: np.ndarray) -> float:
            A = sum(c * E for c, E in zip(v, basis_u2))
            U = augment_unitary(mat_expm_iherm(A))
            return i_alpha(U @ sig0 @ U.conj().T, sig0, alpha)

        # Прямая аналитическая проверка точного нуля фотона на конечной амплитуде t = 0.5
        photon_exact = np.array([0.0, 0.0, g_prime, g_weak]) / math.hypot(g_weak, g_prime)
        self.assertLess(abs(f_mass_u2(0.5 * photon_exact)), 1e-14)

        M2_num = np.zeros((4, 4), dtype=float)
        for a in range(4):
            ea = np.zeros(4)
            ea[a] = eps
            M2_num[a, a] = 2.0 * f_mass_u2(ea) / (eps**2)
            for b in range(a + 1, 4):
                eb = np.zeros(4)
                eb[b] = eps
                M2_num[a, b] = M2_num[b, a] = (
                    f_mass_u2(ea + eb) - f_mass_u2(ea - eb)
                ) / (2.0 * eps * eps)

        eigvals, eigvecs = np.linalg.eigh(M2_num)
        # Безопасный численный допуск для конечной разности O(eps_mach / eps^2)
        self.assertLess(abs(eigvals[0]), 1e-7)
        self.assertAlmostEqual(abs(float(np.dot(eigvecs[:, 0], photon_exact))), 1.0, places=7)

        mW2_theory = 0.5 * lam3 * (g_weak**2) * (math.sin(theta0) ** 2)
        mZ2_theory = (
            0.5
            * lam3
            * (g_weak**2 + g_prime**2)
            * (math.sin(theta0) ** 2)
            * (math.cos(theta0) ** 2)
        )
        for num_v, exp_v in zip(eigvals[1:], sorted([mW2_theory, mW2_theory, mZ2_theory])):
            self.assertLess(abs(num_v - exp_v) / exp_v, 1e-6)

        z_vec = np.array([0.0, 0.0, g_weak, -g_prime]) / math.hypot(g_weak, g_prime)
        rho_cust = M2_num[0, 0] / (float(z_vec @ M2_num @ z_vec) * ((g_weak**2) / (g_weak**2 + g_prime**2)))
        self.assertAlmostEqual(rho_cust, 1.0 / (math.cos(theta0) ** 2), places=6)

        # U(3) -> U(2): ровно 4 безмассовых и 5 массивных мод
        psi3 = np.array([0.0, 0.0, math.sin(theta0), math.cos(theta0)], dtype=complex)
        sig3 = rank1_probe(psi3, mu0)
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
                M2_u3[a, b] = M2_u3[b, a] = (
                    f_mass_u3(ea + eb) - f_mass_u3(ea - eb)
                ) / (2.0 * eps * eps)

        eigs_u3 = np.linalg.eigvalsh(M2_u3)
        self.assertEqual(int(np.sum(np.abs(eigs_u3) < 1e-7)), 4)
        self.assertEqual(int(np.sum(eigs_u3 > 1e-3)), 5)

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

            eta_alpha = math.log(b_vac / a_vac) + alpha * (
                (math.sqrt(mu0 + mu1) - math.sqrt(mu0))
                * (math.sqrt(b_vac) - math.sqrt(a_vac))
                / mu1
            )
            rho_max = math.log(1.0 + mu1 / mu0)

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
                return (beta_vac * mu1 * eta_alpha * x + beta_ent * s_term) / dim

            beta_ent = 1.0
            r_broken = 0.65 * rho_max
            beta_vac_broken = r_broken * beta_ent / eta_alpha
            v0_mat = V_matrix(e_vac, beta_vac_broken, beta_ent)

            for _ in range(15):
                psi = rng.standard_normal(dim) + 1j * rng.standard_normal(dim)
                psi /= np.linalg.norm(psi)
                x = float(np.vdot(psi[:N], psi[:N]).real)
                self.assertAlmostEqual(
                    V_matrix(psi, beta_vac_broken, beta_ent) - v0_mat,
                    delta_V_analytic(x, beta_vac_broken, beta_ent),
                    places=12,
                )
                g_aug = augment_unitary(haar_unitary(rng, N))
                phase = np.exp(1j * rng.uniform(0.0, 2.0 * math.pi))
                self.assertAlmostEqual(
                    V_matrix(phase * (g_aug @ psi), beta_vac_broken, beta_ent),
                    V_matrix(psi, beta_vac_broken, beta_ent),
                    places=12,
                )

            beta_vac_sym = (1.25 * rho_max) * beta_ent / eta_alpha
            v0_sym = V_matrix(e_vac, beta_vac_sym, beta_ent)
            for th in np.linspace(0.05, 0.5 * math.pi, 40):
                p = np.zeros(dim, dtype=complex)
                p[N - 1], p[N] = math.sin(th), math.cos(th)
                self.assertGreater(V_matrix(p, beta_vac_sym, beta_ent), v0_sym)

            x0 = (mu1 - mu0 * (math.exp(r_broken) - 1.0)) / (mu1 * (math.exp(r_broken) + 1.0))
            self.assertGreater(x0, 0.0)
            self.assertLess(x0, 0.5)
            theta0 = math.asin(math.sqrt(x0))

            def V_of_theta(th: float) -> float:
                p = np.zeros(dim, dtype=complex)
                p[N - 1], p[N] = math.sin(th), math.cos(th)
                return V_matrix(p, beta_vac_broken, beta_ent)

            v_min = V_of_theta(theta0)
            self.assertLess(v_min, v0_mat)
            self.assertLessEqual(
                v_min, min(V_of_theta(th) for th in np.linspace(0.0, 0.5 * math.pi, 200)) + 1e-13
            )

            h = 1e-4
            d1_num = (V_of_theta(theta0 + h) - V_of_theta(theta0 - h)) / (2.0 * h)
            d2_num = (V_of_theta(theta0 + h) - 2.0 * v_min + V_of_theta(theta0 - h)) / (h * h)
            d2_theory = (
                16.0
                * beta_ent
                * (mu1**2)
                * x0
                * (1.0 - x0)
                * (math.cosh(0.5 * r_broken) ** 2)
                / (dim * (2.0 * mu0 + mu1))
            )
            self.assertLess(abs(d1_num), 1e-7)
            self.assertLess(abs(d2_num - d2_theory) / d2_theory, 1e-5)

            psi0 = np.zeros(dim, dtype=complex)
            psi0[N - 1], psi0[N] = math.sin(theta0), math.cos(theta0)
            for _ in range(10):
                H_raw = rng.standard_normal((N, N)) + 1j * rng.standard_normal((N, N))
                psi_orb = augment_unitary(mat_expm_iherm(0.25 * (H_raw + H_raw.conj().T))) @ psi0
                self.assertAlmostEqual(
                    V_matrix(psi_orb, beta_vac_broken, beta_ent), v_min, places=12
                )

            r_near = 0.99 * rho_max
            x0_near = (mu1 - mu0 * (math.exp(r_near) - 1.0)) / (mu1 * (math.exp(r_near) + 1.0))
            self.assertGreater(x0_near, 0.0)
            self.assertLess(x0_near, 0.02)

    # -------------------------------------------------------------------------
    # Блок V. Аномалии, киральные фермионы и конечномерная модель весового следа (Теоремы 12-14)
    # -------------------------------------------------------------------------

    def test_12_theorem12_sm_anomalies_and_weinberg_3_8(self) -> None:
        yQ, yu, yd, yL, ye = 1.0 / 6.0, 2.0 / 3.0, -1.0 / 3.0, -0.5, -1.0
        self.assertAlmostEqual(2.0 * yQ - yu - yd, 0.0, places=14)
        self.assertAlmostEqual(3.0 * yQ + yL, 0.0, places=14)
        self.assertAlmostEqual(6.0 * yQ - 3.0 * yu - 3.0 * yd + 2.0 * yL - ye, 0.0, places=14)
        self.assertAlmostEqual(
            6.0 * (yQ**3) - 3.0 * (yu**3) - 3.0 * (yd**3) + 2.0 * (yL**3) - (ye**3),
            0.0,
            places=14,
        )
        self.assertEqual((3 + 1) % 2, 0)

        for yq_t, delta_t in ((0.3, 0.5), (-0.7, 1.1), (1.0 / 6.0, 0.5)):
            yl_t, ye_t = -3.0 * yq_t, -6.0 * yq_t
            yu_t, yd_t = yq_t + delta_t, yq_t - delta_t
            cubic = (
                6.0 * (yq_t**3) - 3.0 * (yu_t**3) - 3.0 * (yd_t**3) + 2.0 * (yl_t**3) - (ye_t**3)
            )
            self.assertAlmostEqual(cubic, 18.0 * yq_t * (9.0 * yq_t**2 - delta_t**2), places=13)

        T2_1 = 0.5 * np.array([[0, 1], [1, 0]], dtype=complex)
        T2_2 = 0.5 * np.array([[0, -1j], [1j, 0]], dtype=complex)
        T2_3 = 0.5 * np.array([[1, 0], [0, -1]], dtype=complex)
        T3_1 = 0.5 * np.array([[0, 1, 0], [1, 0, 0], [0, 0, 0]], dtype=complex)
        T3_2 = 0.5 * np.array([[0, -1j, 0], [1j, 0, 0], [0, 0, 0]], dtype=complex)
        T3_4 = 0.5 * np.array([[0, 0, 1], [0, 0, 0], [1, 0, 0]], dtype=complex)
        T3_6 = 0.5 * np.array([[0, 0, 0], [0, 0, 1], [0, 1, 0]], dtype=complex)

        b1 = lambda x, y: 0.4 - 0.3 * y + 0.2 * x * x - 0.35 * (y**3)
        b2 = lambda x, y: 0.35 + 0.45 * x - 0.15 * y * y + 0.4 * (x**3)
        A2_1 = lambda x, y: (0.5 + 0.35 * y + 0.2 * x * x) * T2_1 + (0.3 - 0.25 * x) * T2_3
        A2_2 = lambda x, y: (0.55 + 0.4 * x + 0.15 * y * y) * T2_2 + (0.25 + 0.3 * y) * T2_1
        A3_1 = lambda x, y: (0.45 + 0.3 * y + 0.2 * x * x) * T3_1 + (0.35 - 0.25 * x) * T3_4
        A3_2 = lambda x, y: (0.5 + 0.4 * x + 0.2 * y * y) * T3_2 + (0.3 + 0.25 * y) * T3_6

        x0, y0 = 0.2, -0.15

        def sm_plaquette_action(a: float, w_b: float = 1.0, w_2: float = 1.0, w_3: float = 1.0) -> float:
            flux_b = w_b * a * (
                b1(x0, y0 - 0.5 * a)
                + b2(x0 + 0.5 * a, y0)
                - b1(x0, y0 + 0.5 * a)
                - b2(x0 - 0.5 * a, y0)
            )
            W2 = (
                mat_expm_iherm(w_2 * a * A2_1(x0, y0 - 0.5 * a))
                @ mat_expm_iherm(w_2 * a * A2_2(x0 + 0.5 * a, y0))
                @ mat_expm_iherm(w_2 * a * A2_1(x0, y0 + 0.5 * a)).conj().T
                @ mat_expm_iherm(w_2 * a * A2_2(x0 - 0.5 * a, y0)).conj().T
            )
            W3 = (
                mat_expm_iherm(w_3 * a * A3_1(x0, y0 - 0.5 * a))
                @ mat_expm_iherm(w_3 * a * A3_2(x0 + 0.5 * a, y0))
                @ mat_expm_iherm(w_3 * a * A3_1(x0, y0 + 0.5 * a)).conj().T
                @ mat_expm_iherm(w_3 * a * A3_2(x0 - 0.5 * a, y0)).conj().T
            )
            reps = (
                np.exp(1j * yQ * flux_b) * np.kron(W2, W3),
                np.exp(1j * yu * flux_b) * W3,
                np.exp(1j * yd * flux_b) * W3,
                np.exp(1j * yL * flux_b) * W2,
                np.array([[np.exp(1j * ye * flux_b)]], dtype=complex),
                np.array([[1.0 + 0.0j]], dtype=complex),
            )
            return sum(-float(np.trace(Wr - np.eye(Wr.shape[0], dtype=complex)).real) for Wr in reps)

        self.assertAlmostEqual(sm_plaquette_action(0.1), sm_plaquette_action(-0.1), places=13)

        fB = (0.45 + 1.2 * x0 * x0) - (-0.3 - 1.05 * y0 * y0)
        F2 = 0.4 * T2_2 - 0.35 * T2_1 + 1j * (
            A2_1(x0, y0) @ A2_2(x0, y0) - A2_2(x0, y0) @ A2_1(x0, y0)
        )
        F3 = 0.4 * T3_2 - 0.3 * T3_1 + 1j * (
            A3_1(x0, y0) @ A3_2(x0, y0) - A3_2(x0, y0) @ A3_1(x0, y0)
        )
        tr_F2_sq = float(np.trace(F2 @ F2).real)
        tr_F3_sq = float(np.trace(F3 @ F3).real)
        lead_coeff = (5.0 / 3.0) * (fB**2) + 2.0 * tr_F2_sq + 2.0 * tr_F3_sq

        rems = [abs(sm_plaquette_action(a) - (a**4) * lead_coeff) for a in (0.16, 0.08, 0.04)]
        self.assertTrue(5.85 < math.log2(rems[0] / rems[1]) < 6.15)
        self.assertTrue(5.92 < math.log2(rems[1] / rems[2]) < 6.08)

        # Экстраполяция Ричардсона (a = 0.04 и 0.02) убирает O(a^2) без потери значащих цифр
        def richardson_coeff(w_b: float, w_2: float, w_3: float, norm: float) -> float:
            c_coarse = sm_plaquette_action(0.04, w_b, w_2, w_3) / ((0.04**4) * norm)
            c_fine = sm_plaquette_action(0.02, w_b, w_2, w_3) / ((0.02**4) * norm)
            return (4.0 * c_fine - c_coarse) / 3.0

        inv_g3_sq = richardson_coeff(0.0, 0.0, 1.0, 2.0 * tr_F3_sq)
        inv_g2_sq = richardson_coeff(0.0, 1.0, 0.0, 2.0 * tr_F2_sq)
        inv_g1_sq = richardson_coeff(1.0, 0.0, 0.0, fB**2)
        self.assertAlmostEqual(inv_g3_sq / inv_g2_sq, 1.0, places=4)
        self.assertAlmostEqual(inv_g1_sq / inv_g2_sq, 5.0 / 3.0, places=4)
        self.assertAlmostEqual(inv_g2_sq / (inv_g1_sq + inv_g2_sq), 3.0 / 8.0, places=4)

    def test_13_theorem13_chiral_dirac_yukawa_and_quartic_higgs(self) -> None:
        rng = np.random.default_rng(13001)
        I3 = np.eye(3, dtype=complex)
        I48 = np.eye(48, dtype=complex)
        gamma_F = np.diag([1.0] * 24 + [-1.0] * 24).astype(complex)

        def make_yukawa(svals: tuple[float, float, float]) -> np.ndarray:
            return haar_unitary(rng, 3) @ np.diag(svals) @ haar_unitary(rng, 3).conj().T

        Yu = make_yukawa((1.25, 0.55, 0.25))
        Yd = make_yukawa((0.60, 0.35, 0.18))
        Ynu = make_yukawa((0.40, 0.22, 0.12))
        Ye = make_yukawa((0.50, 0.28, 0.15))

        tilde = lambda phi: np.array([phi[1].conjugate(), -phi[0].conjugate()], dtype=complex)

        def dirac_op(phi: np.ndarray) -> np.ndarray:
            phi_dag = phi.conj().reshape(1, 2)
            tphi_dag = tilde(phi).conj().reshape(1, 2)
            M = np.zeros((24, 24), dtype=complex)
            M[0:9, 0:18] = np.kron(tphi_dag, np.kron(I3, Yu.conj().T))
            M[9:18, 0:18] = np.kron(phi_dag, np.kron(I3, Yd.conj().T))
            M[18:21, 18:24] = np.kron(tphi_dag, Ynu.conj().T)
            M[21:24, 18:24] = np.kron(phi_dag, Ye.conj().T)
            D = np.zeros((48, 48), dtype=complex)
            D[0:24, 24:48] = M.conj().T
            D[24:48, 0:24] = M
            return D

        def sm_gauge_matrix(g3: np.ndarray, g2: np.ndarray, th: float) -> np.ndarray:
            return block_diag(
                [
                    np.exp(1j * th / 6.0) * np.kron(g2, np.kron(g3, I3)),
                    np.exp(-0.5j * th) * np.kron(g2, I3),
                    np.exp(2j * th / 3.0) * np.kron(g3, I3),
                    np.exp(-1j * th / 3.0) * np.kron(g3, I3),
                    I3.copy(),
                    np.exp(-1j * th) * I3,
                ]
            )

        phi = np.array([0.45 + 0.2j, 0.65 - 0.25j], dtype=complex)
        norm_phi = float(np.linalg.norm(phi))
        D_phi = dirac_op(phi)

        self.assertLess(np.linalg.norm(D_phi - D_phi.conj().T), 1e-14)
        self.assertLess(np.linalg.norm(D_phi @ gamma_F + gamma_F @ D_phi), 1e-14)
        for _ in range(10):
            g3, g2 = haar_su(rng, 3), haar_su(rng, 2)
            th = float(rng.uniform(0.0, 2.0 * math.pi))
            U_g = sm_gauge_matrix(g3, g2, th)
            phi_g = np.exp(0.5j * th) * (g2 @ phi)
            self.assertLess(np.linalg.norm(U_g @ D_phi @ U_g.conj().T - dirac_op(phi_g)), 1e-12)

        u_uL, s_u, _ = np.linalg.svd(Yu)
        u_dL, s_d, _ = np.linalg.svd(Yd)
        _, s_nu, _ = np.linalg.svd(Ynu)
        _, s_e, _ = np.linalg.svd(Ye)
        V_ckm = u_uL.conj().T @ u_dL
        self.assertLess(np.linalg.norm(V_ckm.conj().T @ V_ckm - I3), 1e-13)
        self.assertGreater(np.linalg.norm(V_ckm - I3), 0.1)

        pos_m = np.concatenate([np.repeat(s_u, 3), np.repeat(s_d, 3), s_nu, s_e]) * norm_phi
        self.assertLess(
            np.max(np.abs(np.linalg.eigvalsh(D_phi) - np.sort(np.concatenate([-pos_m, pos_m])))),
            1e-12,
        )

        y2_half = np.concatenate([np.repeat(s_u**2, 3), np.repeat(s_d**2, 3), s_nu**2, s_e**2])
        y2_all = np.concatenate([y2_half, y2_half])
        var_y2 = float(np.mean((y2_all - np.mean(y2_all)) ** 2))
        cum3_y2 = float(np.mean((y2_all - np.mean(y2_all)) ** 3))

        alpha = 1.5
        D2 = D_phi @ D_phi

        def gibbs(eps_val: float) -> np.ndarray:
            vals, vecs = np.linalg.eigh(0.5 * (D2 + D2.conj().T))
            rho = (vecs * np.exp(-eps_val * vals)) @ vecs.conj().T
            return rho / tr_norm(rho)

        rems_3, rems_4 = [], []
        for eps_val in (0.08, 0.04, 0.02):
            val = i_alpha(gibbs(eps_val), I48, alpha)
            lead_2 = ((4.0 + alpha) / 8.0) * (eps_val**2) * var_y2 * (norm_phi**4)
            sub_3 = -((16.0 + 3.0 * alpha) / 48.0) * (eps_val**3) * cum3_y2 * (norm_phi**6)
            rems_3.append(abs(val - lead_2))
            rems_4.append(abs(val - (lead_2 + sub_3)))

        self.assertTrue(2.85 < math.log2(rems_3[0] / rems_3[1]) < 3.15)
        self.assertTrue(2.92 < math.log2(rems_3[1] / rems_3[2]) < 3.08)
        self.assertTrue(3.75 < math.log2(rems_4[0] / rems_4[1]) < 4.25)
        self.assertTrue(3.85 < math.log2(rems_4[1] / rems_4[2]) < 4.15)

    def test_14_weighted_finite_matrix_model_and_rg_crossing(self) -> None:
        rng = np.random.default_rng(14001)
        w_in, w_out = 7.3, 2.9  # Произвольные масштабы следа: Tr_w(I_N) != 1!
        N, K = 6, 4

        # 1. Теорема 1 в полуконечном следе Tr_{w_in}: gamma_loc = 4 не зависит от Tr_w(I)
        sigma = random_state_w(rng, N, w_in, shift=0.5)
        self.assertAlmostEqual(tr_semifinite(sigma, w_in), 1.0, places=14)
        self.assertGreater(tr_semifinite(np.eye(N), w_in), 40.0)

        H = rng.standard_normal((N, N)) + 1j * rng.standard_normal((N, N))
        drho = 0.5 * (H + H.conj().T)
        drho -= (tr_semifinite(drho, w_in) / tr_semifinite(np.eye(N), w_in)) * np.eye(N)
        drho /= np.linalg.norm(drho)
        g_bkm, g_h = analytical_hessians(sigma, drho, trace_weight=w_in)
        self.assertGreater(g_bkm / g_h, 4.0)

        _, vecs = np.linalg.eigh(sigma)
        d_diag = np.linspace(-1.0, 1.0, N)
        d_diag -= d_diag.mean()
        drho_c = (vecs * d_diag) @ vecs.conj().T
        g_bkm_c, g_h_c = analytical_hessians(sigma, drho_c, trace_weight=w_in)
        self.assertAlmostEqual(g_bkm_c / g_h_c, 4.0, places=12)

        # 2. Теоремы 2 и 4А в полуконечном следе (глобальная граница 2 и DPI при alpha >= 0)
        kraus = random_tau_channel_kraus(rng, N, K, num_kraus=4)
        for _ in range(100):
            r1 = random_state_w(rng, N, w_in, shift=0.05)
            r2 = random_state_w(rng, N, w_in, shift=0.05)
            s_in = rel_entropy_w(r1, r2, w_in)
            f_in = affinity_half_w(r1, r2, w_in)
            self.assertGreaterEqual(s_in - (-2.0 * math.log(f_in)), -1e-12)
            self.assertGreaterEqual((-2.0 * math.log(f_in)) - 2.0 * (1.0 - f_in), -1e-12)

            pr1 = apply_semifinite_channel(kraus, r1, w_in, w_out)
            pr2 = apply_semifinite_channel(kraus, r2, w_in, w_out)
            self.assertAlmostEqual(tr_semifinite(pr1, w_out), 1.0, places=12)
            self.assertAlmostEqual(tr_semifinite(pr2, w_out), 1.0, places=12)

            s_out = rel_entropy_w(pr1, pr2, w_out)
            f_out = affinity_half_w(pr1, pr2, w_out)
            self.assertLessEqual(s_out, s_in + 1e-12)
            self.assertGreaterEqual(f_out, f_in - 1e-12)

        # 3. Конечномерный суррогат с весовым следом: Tr(I_10)=10; это не фактор II_infty.
        eta = 1e-8
        s_block = (1.0 - 7.0 * eta) / 3.0
        sigma_10 = np.diag([s_block, s_block, s_block] + [eta] * 7)
        S12_10 = np.eye(10)
        S12_10[0, 0] = S12_10[1, 1] = 0.0
        S12_10[0, 1] = S12_10[1, 0] = 1.0
        phi_swap_10 = lambda X: 0.5 * (X + S12_10 @ X @ S12_10)

        for gamma in (10.0, 1.5, 0.5, 0.05):
            crit = gamma * (2.0 - math.sqrt(2.0)) / (2.0 * math.log(2.0))
            sm = 0.5 * min(1.0, crit)
            m = sm * sm
            eps = 1e-11 * m
            rho_10 = np.diag([s_block * eps, s_block * (2.0 * m - eps), s_block * (3.0 - 2.0 * m)] + [eta] * 7)
            self.assertAlmostEqual(tr_semifinite(rho_10, 1.0), 1.0, places=14)
            phi_rho_10 = phi_swap_10(rho_10)

            j_in = rel_entropy_w(rho_10, sigma_10, 1.0) - gamma * (
                1.0 - affinity_half_w(rho_10, sigma_10, 1.0)
            )
            j_out = rel_entropy_w(phi_rho_10, sigma_10, 1.0) - gamma * (
                1.0 - affinity_half_w(phi_rho_10, sigma_10, 1.0)
            )
            delta_exact = s_block * sm * (gamma * (2.0 - math.sqrt(2.0)) - 2.0 * math.log(2.0) * sm)
            self.assertGreater(j_out - j_in, 0.0)
            self.assertLess(abs((j_out - j_in) - delta_exact) / delta_exact, 1e-4)

        # 4. 1-петлевой бег констант СМ (экзамен №5): пересечение 1/alpha_1 = 1/alpha_2 => sin^2 = 3/8
        a1_mz, a2_mz, a3_mz = 59.02, 29.58, 8.47
        b1, b2, b3 = 4.1, -19.0 / 6.0, -7.0
        t_cross = 2.0 * math.pi * (a1_mz - a2_mz) / (b1 - b2)
        log10_mu_cross = math.log10(91.188) + t_cross / math.log(10.0)
        a1_c = a1_mz - (b1 / (2.0 * math.pi)) * t_cross
        a2_c = a2_mz - (b2 / (2.0 * math.pi)) * t_cross
        a3_c = a3_mz - (b3 / (2.0 * math.pi)) * t_cross
        sin2_cross = a2_c / ((5.0 / 3.0) * a1_c + a2_c)

        self.assertAlmostEqual(a1_c, a2_c, places=12)
        self.assertAlmostEqual(sin2_cross, 3.0 / 8.0, places=12)
        self.assertTrue(12.9 < log10_mu_cross < 13.15)
        self.assertTrue(5.0 < (a2_c - a3_c) < 6.2)  # Классический треугольник несовпадения СМ





        # 5. Усиленный DPI-контрпример с общим строго положительным ограниченным хвостом.
        gamma, eta = 0.5, 0.25
        sm = 0.5 * min(1.0, gamma * (2.0 - math.sqrt(2.0)) / (2.0 * math.log(2.0)))
        m, eps = sm * sm, 1e-12 * sm * sm
        omega_tail = np.diag([0.0, 0.0, 0.0, 2.0 / 3.0, 1.0 / 3.0]).astype(complex)
        nu_tail = np.diag([0.0, 0.0, 0.0, 0.4, 0.6]).astype(complex)
        sig_eta = (1.0 - eta) * np.diag([1.0 / 3.0] * 3 + [0.0, 0.0]) + eta * omega_tail
        rho_eta = (1.0 - eta) * np.diag([
            eps / 3.0, (2.0 * m - eps) / 3.0, (3.0 - 2.0 * m) / 3.0, 0.0, 0.0
        ]) + eta * omega_tail

        def phi_tail(X: np.ndarray) -> np.ndarray:
            d = np.diag(X).real
            avg01 = 0.5 * (d[0] + d[1])
            tail_mass = d[3] + d[4]
            return (
                np.diag([avg01, avg01, d[2], 0.0, 0.0]).astype(complex)
                + tail_mass * nu_tail
            )

        ps_eta, pr_eta = phi_tail(sig_eta), phi_tail(rho_eta)
        self.assertGreater(float(np.linalg.eigvalsh(rho_eta).min()), 0.0)
        self.assertGreater(float(np.linalg.eigvalsh(sig_eta).min()), 0.0)
        self.assertGreater(float(np.linalg.eigvalsh(pr_eta).min()), 0.0)
        self.assertGreater(float(np.linalg.eigvalsh(ps_eta).min()), 0.0)
        j_in = rel_entropy_w(rho_eta, sig_eta, 1.0) - gamma * (
            1.0 - affinity_half_w(rho_eta, sig_eta, 1.0)
        )
        j_out = rel_entropy_w(pr_eta, ps_eta, 1.0) - gamma * (
            1.0 - affinity_half_w(pr_eta, ps_eta, 1.0)
        )
        exact_jump = (1.0 - eta) * (sm / 3.0) * (
            gamma * (2.0 - math.sqrt(2.0)) - 2.0 * math.log(2.0) * sm
        )
        self.assertGreater(j_out - j_in, 0.0)
        self.assertLess(abs((j_out - j_in) - exact_jump) / exact_jump, 1e-5)

    def test_15_lemmaA5_resolvent_integrals_and_psd_factorizations(self) -> None:
        rng = np.random.default_rng(7201)
        dim, weight = 5, 6.7
        I_n = np.eye(dim, dtype=complex)
        # 80-точечная квадратура Гаусса — Лежандра на (0, pi/2), t = tan^2(theta).
        nodes, weights_gl = np.polynomial.legendre.leggauss(80)
        thetas = 0.25 * math.pi * (nodes + 1.0)
        dthetas = 0.25 * math.pi * weights_gl

        for _ in range(8):
            rho = random_state_w(rng, dim, weight, 0.35)
            sigma = random_state_w(rng, dim, weight, 0.35)
            X = rho - sigma
            sqrt_sig = mat_func(sigma, np.sqrt)
            sqrt_rho = mat_func(rho, np.sqrt)
            s_ex = rel_entropy_w(rho, sigma, weight)
            f_ex = weight * float(np.trace(sqrt_rho @ sqrt_sig).real)

            int_S, int_F = 0.0, 0.0
            for th, dth in zip(thetas, dthetas):
                tan_th = math.tan(th)
                sec2_th = 1.0 / (math.cos(th) ** 2)
                t = tan_th * tan_th
                dt = 2.0 * tan_th * sec2_th * dth
                inv_sig = np.linalg.inv(sigma + t * I_n)
                inv_rho = np.linalg.inv(rho + t * I_n)

                A_t = X @ inv_sig
                M1_raw = A_t.conj().T @ inv_rho @ A_t
                M1 = 0.5 * (M1_raw + M1_raw.conj().T)
                self.assertGreaterEqual(float(np.linalg.eigvalsh(M1).min()), -1e-13)

                C_sqrt = mat_func(inv_sig @ sqrt_sig @ inv_sig, np.sqrt)
                B_t = X @ C_sqrt
                M2_raw = B_t.conj().T @ inv_rho @ B_t
                M2 = 0.5 * (M2_raw + M2_raw.conj().T)
                self.assertGreaterEqual(float(np.linalg.eigvalsh(M2).min()), -1e-13)

                # Двухшаговое резольвентное тождество I_2(t), в каждом узле квадратуры.
                i2_lhs = weight * float(np.trace(M2).real)
                i2_rhs = weight * float(
                    np.trace(
                        sqrt_sig @ inv_sig @ inv_sig @ X
                        + sqrt_sig @ (inv_rho - inv_sig)
                    ).real
                )
                i2_scale = max(1.0, abs(i2_lhs), abs(i2_rhs))
                self.assertLess(abs(i2_lhs - i2_rhs) / i2_scale, 1e-13)

                int_S += t * weight * float(np.trace(M1).real) * dt
                int_F += (math.sqrt(t) / math.pi) * weight * float(np.trace(M2).real) * dt

            self.assertAlmostEqual(int_S, s_ex, places=10)
            self.assertAlmostEqual(int_F, 1.0 - f_ex, places=10)

if __name__ == "__main__":
    unittest.main(verbosity=2)
