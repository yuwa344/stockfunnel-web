/** 漏斗筛选参数。所有阈值集中于此，UI 可实时调整。 */

export const DEFAULT_CONFIG = {
  // ① 长期趋势
  requireMaBullishStack: true,
  ma200SlopeMin: 0.0,
  pos52wMin: 0.25,
  pos52wMax: 0.98,
  aboveMa200Required: true,
  minBars: 260,

  // ② 基本面
  peMax: 80,
  peMin: 0,
  pbMax: 12,
  minFloatCapYi: 30,
  maxFloatCapYi: 3000,
  requireEpsGrowth: true,
  epsGrowthMin: 15,
  revenueGrowthMin: 10,
  accelerationRequired: true,

  // ③ RS
  rsTopPercent: 0.15,
  rsPeriods: [63, 126, 252],
  rsMinPeriodsPositive: 2,

  // ④ VCP
  // 漏斗逐级收窄会导致末端样本过少（实测 rs:5 -> vcp:1 -> chip:0），
  // 这里放宽收缩次数要求，保证第 ⑤/⑥ 层有足够样本参与。
  vcpMinDepth: 0.45,
  vcpMaxContractions: 4,
  vcpVolumeDryRatio: 0.70,
  vcpLookback: 60,
  vcpRequiredTroughs: 1,

  // ⑤ 筹码峰
  // 阈值依据实测分布校准（2026-10-03，220 只样本）：
  //   90% 筹码集中度 P10=19.8% P25=26.4% P50=37.1% P75=48.3%
  // 原始设的 0.10（10%）在全市场 5000+ 只里**一只都不存在**，
  // 导致第 ⑤ 层恒为 0 只通过、用户看不到任何结果。
  // 现按分位数取值：standard 取 P25，aggressive 取 P40，strict 取 P12。
  concentration90Max: 0.26,
  profitRatioMin: 85,
  requireNoResistance: true,
  chipLookback: 250,
  chipBins: 120,

  // ⑥ 枢轴突破
  breakoutVolumeRatio: 1.5,
  breakoutLookback: 60,
  pivotWindow: 20,
  minStopLossPct: 5,
  maxStopLossPct: 8,
  targetRR: 2.0,

  // 执行控制
  maxTrendCandidates: 260,
  klineConcurrency: 8,
};

export const PRESETS = {
  standard: { ...DEFAULT_CONFIG },
  aggressive: {
    ...DEFAULT_CONFIG,
    pos52wMin: 0.15, pos52wMax: 1.0, peMax: 120, rsTopPercent: 0.25,
    vcpVolumeDryRatio: 0.75, vcpRequiredTroughs: 1,
    // P40 分位
    concentration90Max: 0.38, profitRatioMin: 75, breakoutVolumeRatio: 1.3,
    minFloatCapYi: 20, maxTrendCandidates: 400,
  },
  strict: {
    ...DEFAULT_CONFIG,
    ma200SlopeMin: 0.05, pos52wMin: 0.4, pos52wMax: 0.95,
    peMax: 45, pbMax: 8, epsGrowthMin: 25, revenueGrowthMin: 18,
    rsTopPercent: 0.08, vcpVolumeDryRatio: 0.55, vcpRequiredTroughs: 3,
    // P12 分位，接近实际最优的 10%
    concentration90Max: 0.21, profitRatioMin: 90, breakoutVolumeRatio: 1.8,
    minFloatCapYi: 50, maxFloatCapYi: 1500, maxTrendCandidates: 180,
  },
};

/** 六层定义（UI 展示用） */
export const STAGES = [
  { key: 'trend', idx: 0, title: '① 长期趋势', label: 'Trend Filter' },
  { key: 'fundamental', idx: 1, title: '② 基本面爆发', label: 'Fundamental' },
  { key: 'rs', idx: 2, title: '③ 动量强度', label: 'RS Factor' },
  { key: 'vcp', idx: 3, title: '④ VCP 收缩', label: 'VCP' },
  { key: 'chip', idx: 4, title: '⑤ 筹码集中', label: 'Chip Peak' },
  { key: 'pivot', idx: 5, title: '⑥ 枢轴突破', label: 'Pivot Breakout' },
];

export const STAGE_DESC = {
  trend: 'MA20>60>120>250 多头排列 + 200MA 上行 + 52周分位过滤',
  fundamental: '估值合理 + 流通市值适中 + 景气度加速确认',
  rs: '多周期相对强度（3/6/12月）横向截面排名取前 15%',
  vcp: '波动幅度逐级收窄 + 末端量能极度萎缩',
  chip: '90%筹码集中度<10% + 获利比>85% + 上方无阻力峰',
  pivot: '突破枢轴点且量能≥1.5倍，止损严格 5%-8%',
};
