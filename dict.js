/* ============================================================================
 * DeclineLens 诊断引擎 —— 唯一字典源
 * ----------------------------------------------------------------------------
 * 这个文件同时被两处使用，**不要复制它**：
 *   1. 扩展版：popup.html 里 <script src="dict.js"> 先于 popup.js 加载
 *   2. 油猴版：build.py 把本文件整段内联进 userscript.template.js
 *
 * 之前 v2.1 出过一次事故：油猴版手抄了一份字典，抄完就开始漂——扩展版 42 条、
 * 油猴版 19 条，注释还写着"与扩展版同源"。收成一份，是为了让那种漂移在物理上
 * 不可能发生，而不是靠人记得两边都改。
 *
 * 因此本文件必须保持"纯净"：
 *   - 只用 const 声明，不用 import/export，不碰 window/chrome/GM_* 任何宿主 API
 *   - 不产生副作用，加载它等于什么都没发生
 * 违反任何一条，两个宿主里就会有一个跑不起来。
 * ========================================================================== */

/* --------------------------------------------------------------------------
 * 项目地址 —— 改这一处，扩展版和油猴版两边的链接同时生效
 * ↓↓↓ 建仓后把它换成真实地址 ↓↓↓
 * ------------------------------------------------------------------------ */
const REPO_URL = "https://github.com/luck2026228/DeclineLens";

/* 仓库还没建、上面还是占位符期间，任何地方都不许把用户引向那个 404：
 * popup 和油猴版的 issue 入口会隐藏，未收录码的建议文案也会换掉。
 * 建仓后把上面换成真实地址，一切自动恢复。 */
const REPO_OK = REPO_URL.indexOf("CHANGE-ME") < 0;

/* --------------------------------------------------------------------------
 * 第一层：官方 decline_code 字典
 *
 * 每条是 [为什么被拒, 该怎么办]。"该怎么办"必须是用户下一步能动手做的事——
 * "联系发卡行"这种正确但没用的话，尽量写成"打银行电话说要开境外无卡支付"。
 * 这一层的价值不在覆盖率，在于第二个字段。
 * ------------------------------------------------------------------------ */
const DICT = {
  // ── 银行侧：卡本身没问题，是发卡行不放行 ──
  generic_decline:         ["银行无理由拒绝", "打发卡行电话，要求开通【境外无卡支付 / 线上外币交易】"],
  do_not_honor:            ["银行拒绝，且不说明原因", "同上；也可能是风控，隔几小时再试一次，还不行就换卡"],
  call_issuer:             ["银行要求你联系发卡行", "打卡背面的客服电话核实身份，通常是临时风控"],
  not_permitted:           ["该交易类型不被允许", "卡被限制了线上或跨境交易 → 找银行开通"],
  transaction_not_allowed: ["交易类型不被允许", "国内单币卡付美元的典型报错 → 换双币卡或虚拟卡"],
  service_not_allowed:     ["该服务不被允许", "换卡"],
  restricted_card:         ["受限卡", "卡有使用范围限制（如仅限境内）→ 换卡"],
  revocation_of_authorization:      ["银行已撤销本商户的授权", "你之前可能取消过该商户的扣款授权 → 联系银行恢复"],
  revocation_of_all_authorizations: ["银行已撤销全部授权", "联系银行，通常是卡被冻结"],
  stop_payment_order:      ["银行下了止付令", "联系银行解除"],
  approve_with_id:         ["需要身份验证后才能通过", "完成银行的身份验证流程"],

  // ── 卡种侧：卡就不支持这笔交易 ──
  card_not_supported:      ["这张卡不支持此类交易", "国内单币 / 人民币卡的典型报错 → 换双币卡或虚拟卡"],
  currency_not_supported:  ["这张卡不支持该币种", "卡没开外币结算 → 换支持美元的卡"],
  invalid_account:         ["账户无效", "换卡"],
  new_account_information_available: ["卡已换新，旧卡号失效", "联系发卡行拿新卡号，或直接用新卡"],

  // ── 风控侧：换卡段，别硬试 ──
  fraudulent:              ["风控判定为欺诈", "这个卡段已被商户或 Stripe 拉黑 → 换卡产品 / 换卡段"],
  stolen_card:             ["风控判定为盗刷卡", "换卡段。同一卡段继续试只会加深标记"],
  lost_card:               ["风控判定为挂失卡", "换卡段"],
  merchant_blacklist:      ["该商户把你的卡段拉黑了", "换卡段。这是商户自己的名单，跟你的卡好坏无关"],
  security_violation:      ["安全违规", "换卡，且不要继续尝试"],
  pickup_card:             ["银行要求没收此卡（罕见）", "这张卡已被银行标记，换卡"],

  // ── 频率侧：等，或者换 ──
  card_velocity_exceeded:  ["同一张卡尝试过于频繁", "冷却几小时再试，或直接换卡"],
  card_decline_rate_limit_exceeded: ["这张卡近期失败次数太多，被临时限流", "等 24 小时；期间再试只会重置计时"],
  withdrawal_count_limit_exceeded:  ["超出交易次数限制", "次日再试，或换卡"],
  duplicate_transaction:   ["与刚才那笔重复", "别重复提交——先去账单里确认是不是已经扣款成功了"],
  try_again_later:         ["被要求稍后重试", "冷却几分钟再试"],
  reenter_transaction:     ["交易需重新提交", "原样重试一次即可"],
  no_action_taken:         ["银行没有处理这笔交易", "重试；连续出现就换卡"],

  // ── 信息侧：填错了，改一下就好（这一类是唯一"改了必成"的） ──
  incorrect_number:        ["卡号错误", "核对卡号"],
  invalid_number:          ["卡号无效", "核对卡号，注意别把空格或短横线带进去"],
  incorrect_cvc:           ["CVC 安全码错误", "卡背面签名栏那三位数（Amex 是正面四位）"],
  invalid_cvc:             ["CVC 安全码无效", "核对 CVC 位数：Visa/MC 三位，Amex 四位"],
  expired_card:            ["卡已过期", "看一眼有效期，过期了就用新卡"],
  invalid_expiry:          ["有效期无效", "格式是 MM/YY，别写成年在前"],
  invalid_expiry_month:    ["有效期的月份不对", "月份是 01–12"],
  invalid_expiry_year:     ["有效期的年份不对", "填卡面上印的那个年份，通常是两位"],
  incorrect_zip:           ["账单邮编与银行记录不符", "填开卡时登记的邮编；国内卡常见填法见 README"],
  incorrect_pin:           ["PIN 码错误", "线上交易一般用不到 PIN，换卡"],
  invalid_pin:             ["PIN 码无效", "换卡"],
  pin_try_exceeded:        ["PIN 尝试次数超限", "卡已被锁，联系银行"],
  offline_pin_required:            ["需要离线 PIN", "线上场景不支持，换卡"],
  online_or_offline_pin_required:  ["需要输入 PIN", "线上场景不支持，换卡"],
  cardholder_name_required:["需要填持卡人姓名", "补全姓名，用卡面上的拼写"],
  invalid_amount:          ["金额异常", "不是你的问题，联系商户"],
  incorrect_address:       ["账单地址与银行记录不符", "改成开卡时登记的地址，尤其国家和邮编"],
  insufficient_funds:      ["余额不足", "充值后再试。$0 试用也要求卡里有几美元用于验资"],
  card_not_activated:      ["卡尚未激活", "先按发卡行短信 / APP 完成激活，再付款"],
  debit_not_authorized:    ["借记卡未授权此交易", "换信用卡，或找银行开通借记卡线上支付"],
  highest_risk_level:      ["Stripe 风控评为最高风险", "换卡段。同一张继续试只会加深标记"],

  // ── 需要额外验证 ──
  authentication_required: ["需要 3DS 验证", "完成银行发来的短信 / APP 弹窗验证。别关页面"],

  // ── 平台侧：跟你的卡无关 ──
  processing_error:        ["支付处理临时故障", "稍后重试，这不是你的卡的问题"],
  issuer_not_available:    ["发卡行通道故障", "稍后重试，这不是你的卡的问题"],

  // ── 测试模式：开发者才会看到 ──
  testmode_decline:        ["测试模式的专用拒绝码", "商户在用测试卡调试，不是真实拒绝"],
  live_mode_test_card:     ["在正式环境用了测试卡号", "换成真卡；4242… 那类号只能在测试环境用"],
  test_mode_live_card:     ["在测试环境用了真卡", "开发者：换成 Stripe 的测试卡号"],
};

/* --------------------------------------------------------------------------
 * 第二层：报文细分规则
 *
 * 为什么必须有这一层：实际拒付里 generic_decline 和 do_not_honor 占绝大多数，
 * 而这两个码本身等于什么都没说。Stripe 给的 message 里往往藏着更准的线索
 * （"does not support this type of purchase" ≠ "international transactions"），
 * 光看码会把这两种完全不同的处置方式混成一句"打电话给银行"。
 *
 * 顺序即优先级：越具体的规则越靠前，命中即停。
 * ------------------------------------------------------------------------ */
const MSG_RULES = [
  [/does not support this type of purchase/i, "卡不支持这种购买类型",   "九成是单币 / 人民币卡碰上了外币订阅 → 换双币卡或虚拟卡"],
  [/recurring|subscription|订阅|续费|循环/i,   "卡不支持循环扣款",       "找银行开通【循环扣款 / 代扣】权限，或换支持订阅的虚拟卡"],
  [/international|cross.?border|境外|跨境/i,   "境外交易未开通",         "打银行电话开通【境外无卡支付】，这一步通常当场生效"],
  [/currency|币种|外币/i,                       "币种不兼容",             "卡没开外币结算 → 找银行开通，或换双币卡"],
  [/online|e-?commerce|网上|线上/i,             "线上交易未开通",         "银行 APP 里找到【网上支付 / 无卡支付】开关，打开它"],
  [/3ds|3-d secure|authentication|验证/i,       "缺 3DS 验证",            "完成银行短信或 APP 弹窗验证，别中途关页面"],
  [/insufficient|余额不足/i,                    "余额不足",               "充值后再试。$0 试用也要求卡里有几美元用于验资"],
  [/velocity|too many|频繁|次数/i,              "短时间尝试太多次",       "冷却一小时。继续试会重置计时，越试越久"],
  [/fraud|risk|欺诈|风险|风控/i,                "风控拦截",               "换卡段。同一卡段反复试会加深标记"],
  [/cvv|cvc|security code|安全码/i,             "安全码有问题",           "卡背面那三位数（Amex 是正面四位）"],
  [/expir|过期|有效期/i,                        "有效期有问题",           "格式 MM/YY，确认卡没过期"],
  [/zip|postal|邮编/i,                          "账单邮编不匹配",         "填开卡时登记的邮编"],
];

/* --------------------------------------------------------------------------
 * Stripe 的 advice_code —— 官方给的"还有没有救"
 *
 * 这是整个响应里最该被显眼展示的字段：其他所有诊断都是我们的推断，
 * 只有这个是 Stripe 自己的结论。尤其 do_not_try_again——它明确告诉你
 * 再试是白费，而用户最容易犯的错就是同一张卡连试十次。
 * ------------------------------------------------------------------------ */
const ADVICE_DICT = {
  try_again_later:   ["可以再试", "这次是临时性拒绝，过一会儿原样重试有机会成功", "#ffd166"],
  do_not_try_again:  ["别再试了", "Stripe 明确表示这张卡重试也不会过。换卡，别浪费尝试次数", "#ff6b6b"],
  confirm_card_data: ["信息填错了", "卡号 / 有效期 / CVC 有一项对不上，核对后重填即可，卡本身没问题", "#9acd32"],
};

/* 错误 type —— 当拿不到 decline_code 时的兜底。
 * 注意 invalid_request_error：那是商户自己集成写错了，跟用户的卡毫无关系，
 * 一定要说清楚，否则用户会去折腾自己的卡。 */
const TYPE_DICT = {
  card_error:            ["卡片被拒", "看下面的原始报文"],
  validation_error:      ["表单填写有误", "检查卡号 / 有效期 / CVC 的格式"],
  invalid_request_error: ["商户的集成配置有问题", "不是你的卡的问题，联系商户客服"],
  api_error:             ["Stripe 服务端故障", "稍后重试，与你无关"],
  idempotency_error:     ["重复提交", "刷新页面重新来一次"],
  rate_limit_error:      ["请求过于频繁", "冷却几分钟"],
};

/* --------------------------------------------------------------------------
 * 工具函数
 * ------------------------------------------------------------------------ */

/* HTML 转义。
 *
 * 这个函数救过命，别删：v2.1 的油猴版没有它，而 decline_code 和 message
 * 全都来自被访问站点的 JSON。记录会存下来、并在**之后打开的每个页面**上重新
 * 渲染一遍——于是在 A 站种下的 <img onerror> 会在 checkout.stripe.com 的上下文里
 * 引爆。凡是把外部字符串拼进 innerHTML 的地方，一律先过这里。 */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

/* 金额：Stripe 的 amount 是最小货币单位（美分）。
 * 日元、韩元等零小数币种不该除以 100，否则会把 ¥1000 显示成 ¥10.00。 */
const ZERO_DECIMAL = ["bif","clp","djf","gnf","jpy","kmf","krw","mga","pyg","rwf","ugx","vnd","vuv","xaf","xof","xpf"];
function moneyStr(d) {
  if (d.amount == null || isNaN(d.amount)) return "";
  const cur = String(d.currency || "usd").toLowerCase();
  const v = ZERO_DECIMAL.indexOf(cur) >= 0 ? d.amount : d.amount / 100;
  return v.toFixed(ZERO_DECIMAL.indexOf(cur) >= 0 ? 0 : 2) + " " + cur.toUpperCase();
}

function fmtTime(ts) {
  try { return new Date(ts).toLocaleString("zh-CN", { hour12: false }); }
  catch (e) { return String(ts); }
}

/* 诊断主函数。返回 {code, why, fix, advice}
 *
 * advice 为 null 表示 Stripe 没给 advice_code——这时不要编一个出来。
 * 「不知道」和「Stripe 说可以重试」是完全不同的两件事，混起来就是拿我们的
 * 猜测冒充官方结论。 */
function diagnose(d) {
  const code = d.code || null;
  const type = d.type || null;

  let entry = code ? DICT[code] : null;
  if (!entry && type && TYPE_DICT[type]) entry = TYPE_DICT[type];

  let why = entry ? entry[0] : "未收录的原因码";
  let fix = entry ? entry[1] : (REPO_OK
    ? "点「复制报告」发个 issue，我把它补进字典"
    : "点「复制报告」把这条留存下来，字典收录时会补进去");

  // 原因码太宽泛时，去报文里找更细的线索。
  // 只在宽泛的情况下覆盖——精确的码（如 expired_card）不该被正则改写。
  // card_declined 是 Stripe 的 error.code 不是 decline_code，本身等于没说；
  // 线索往往在 message 里，必须允许报文规则覆盖。
  const isVague = !code || code === "generic_decline" || code === "do_not_honor" || code === "card_declined";
  if (isVague && d.message) {
    for (let i = 0; i < MSG_RULES.length; i++) {
      if (MSG_RULES[i][0].test(d.message)) {
        why = MSG_RULES[i][1];
        fix = MSG_RULES[i][2];
        break;
      }
    }
  }

  const adv = d.adviceCode && ADVICE_DICT[d.adviceCode]
    ? { code: d.adviceCode, label: ADVICE_DICT[d.adviceCode][0],
        text: ADVICE_DICT[d.adviceCode][1], color: ADVICE_DICT[d.adviceCode][2] }
    : null;

  return { code: code || type || "未知", why: why, fix: fix, advice: adv };
}

/* 一条记录 → 纯文本，用于「复制报告」。
 * 这个报告是字典的增长引擎：用户贴到 issue 里，未收录的码就进了下一版。
 * 所以它必须只含诊断所需的字段，不含任何可能是隐私的东西。 */
function reportLine(d) {
  const g = diagnose(d);
  const rows = [
    "[" + fmtTime(d.ts) + "] " + g.code,
    "  站点: " + (d.host || "未知"),
    "  金额: " + (moneyStr(d) || "未知"),
    "  诊断: " + g.why,
    "  建议: " + g.fix,
  ];
  if (g.advice) rows.push("  Stripe 官方建议: " + g.advice.label + "（" + g.advice.code + "）");
  if (d.type) rows.push("  错误类型: " + d.type);
  rows.push("  原始报文: " + (d.message || "无"));
  return rows.join("\n");
}
