import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Copy,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  Film,
  Filter,
  Headphones,
  ImageOff,
  Home,
  Inbox,
  Mail,
  PackageCheck,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShoppingBag,
  Sparkles,
  Star,
  Truck,
  UploadCloud,
  Users,
  X,
} from "lucide-react";
import {
  apiLanes,
  automationEvents,
  creatorFunnelStages,
  creatorLeads as demoCreatorLeads,
  creatorSearchKeywords,
  storeOptions,
  tasks as initialTasks,
} from "./lib/mockData";
import {
  buildTikTokProfileUrl,
  calculateDashboardMetrics,
  calculateCreatorMetrics,
  evaluateCreatorLead,
  filterCreatorLeads,
  filterTasks,
  getNavigationItems,
  getPriorityLabel,
  getStatusLabel,
  groupTasksByShift,
  updateCreatorStatus,
} from "./lib/operations";
import { normalizeEchoTikCreatorRows, parseEchoTikCreatorImport } from "./lib/echotikImport";
import { fetchInfluencerList, fetchInfluencerVideos, mapInfluencerToCreatorLead } from "./lib/echotikApi";
import {
  applyCreatorAutomationResult,
  buildCreatorAutomationPayload,
  getInstagramProfileUrl,
  normalizeCreatorAutomationState,
} from "./lib/creatorAutomation";
import realEchoTikCreatorLeads from "./lib/echotikRealSeed.json";

const navIconMap = {
  dashboard: Home,
  orders: PackageCheck,
  aftersales: Headphones,
  reviews: Star,
  inventory: Archive,
  creators: Users,
  settings: Settings,
};

const moduleMeta = {
  orders: { label: "订单发货", icon: Truck, tone: "teal" },
  aftersales: { label: "售后工单", icon: Headphones, tone: "blue" },
  reviews: { label: "商品评分", icon: Star, tone: "amber" },
  inventory: { label: "库存核对", icon: Archive, tone: "orange" },
  creators: { label: "达人线索", icon: Users, tone: "indigo" },
};

const priorityTone = {
  urgent: "danger",
  high: "danger-soft",
  medium: "warning",
  low: "neutral",
};

const statusTone = {
  open: "open",
  processing: "processing",
  done: "done",
  skipped: "neutral",
};

const filterModules = [
  { value: "all", label: "全部任务" },
  { value: "orders", label: "订单发货" },
  { value: "aftersales", label: "售后" },
  { value: "reviews", label: "评价" },
  { value: "inventory", label: "库存" },
  { value: "creators", label: "达人" },
];

const filterPriorities = [
  { value: "all", label: "全部优先级" },
  { value: "urgent", label: "紧急" },
  { value: "high", label: "高" },
  { value: "medium", label: "中" },
  { value: "low", label: "低" },
];

const creatorNow = new Date("2026-07-07T09:00:00+08:00");
const creatorStorageKey = "tk-saas.creatorLeads.v1";
const demoCreatorIds = new Set(demoCreatorLeads.map((creator) => creator.id));
const realSeedCreatorIds = new Set(realEchoTikCreatorLeads.map((creator) => creator.id));

const creatorStatusTone = {
  imported: "neutral",
  qualified: "processing",
  needs_contact: "warning",
  ready_to_contact: "open",
  contacted: "processing",
  replied: "done",
  sample_sent: "warning",
  published: "done",
  review: "neutral",
};

const creatorAutomationTone = {
  queueing: "processing",
  queued: "processing",
  draft_ready: "done",
  confirmed: "open",
  sent: "done",
  failed: "danger",
  blocked: "warning",
};

function getCreatorAutomationLabel(status) {
  return (
    {
      queueing: "提交中",
      queued: "已入队",
      draft_ready: "草稿就绪",
      confirmed: "人工已确认",
      sent: "已联系",
      failed: "失败",
      blocked: "已阻止",
    }[status] ?? "未生成"
  );
}

function formatMetricDelta(value, direction = "up") {
  return `${direction === "down" ? "↓" : "↑"} ${value}`;
}

function formatCompactNumber(value) {
  const number = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(number)) {
    return "--";
  }

  if (number >= 10000) {
    return `${(number / 10000).toFixed(number >= 100000 ? 0 : 1)}万`;
  }

  return number.toLocaleString("en-US");
}

function formatDecimal(value, digits = 2) {
  const number = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(number)) {
    return "--";
  }

  return number.toFixed(digits);
}

function formatCurrency(value) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number === 0) return "$0";
  if (number >= 10000) {
    return `$${(number / 10000).toFixed(number >= 100000 ? 0 : 1)}万`;
  }
  return `$${number.toLocaleString("en-US")}`;
}

function formatPercent(value) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${number.toFixed(2)}%`;
}

function getCreatorStatusLabel(status) {
  return creatorFunnelStages.find((stage) => stage.id === status)?.label ?? status;
}

function getCountryFlag(region) {
  if (!region || typeof region !== "string") return "";
  const code = region.slice(0, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return region;
  return String.fromCodePoint(...[...code].map((char) => char.charCodeAt(0) + 127397));
}

function getCreatorCover(creator) {
  return (
    creator.highPerformingCoverUrl ??
    creator.recentVideos?.find((video) => video.coverUrl)?.coverUrl ??
    creator.avatarUrl ??
    creator.avatar ??
    ""
  );
}

function buildTikTokVideoUrl(handle, videoId) {
  const cleanHandle = String(handle ?? "").replace(/^@/, "").trim();
  const cleanVideoId = String(videoId ?? "").trim();

  if (!cleanHandle || !cleanVideoId) {
    return "";
  }

  return `https://www.tiktok.com/@${cleanHandle}/video/${cleanVideoId}`;
}

function getVideoUrl(video, creator) {
  return (
    video?.videoUrl ||
    video?.shareUrl ||
    buildTikTokVideoUrl(video?.uniqueId || creator?.handle, video?.videoId || video?.id)
  );
}

function formatShortDate(value) {
  if (!value) return "缺发布时间";
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toISOString().split("T")[0];
}

function mapFetchedVideos(videos) {
  return videos.map((video) => ({
    id: video.id,
    videoId: video.videoId || video.id,
    title: video.title || video.description || "",
    description: video.description || video.title || "",
    views: video.views,
    likes: video.likes,
    comments: video.comments,
    shares: video.shares,
    createDate: video.createDate,
    coverUrl: video.coverUrl,
    videoUrl: video.videoUrl,
    shareUrl: video.videoUrl,
    hasProducts: video.hasProducts,
    productIds: video.productIds,
    salesCount: video.salesCount,
    salesGmv: video.salesGmv,
  }));
}

function mergeRealCreatorLeads(creators) {
  const current = (Array.isArray(creators) ? creators : [])
    .filter((creator) => !demoCreatorIds.has(creator.id))
    .map(normalizeCreatorAutomationState);
  const currentIds = new Set(current.map((creator) => creator.id));
  const missingRealItems = realEchoTikCreatorLeads
    .filter((creator) => !currentIds.has(creator.id))
    .map(normalizeCreatorAutomationState);

  return missingRealItems.length > 0 ? [...missingRealItems, ...current] : current;
}

function loadSavedCreatorLeads() {
  if (typeof window === "undefined") {
    return realEchoTikCreatorLeads;
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(creatorStorageKey) || "[]");
    if (!Array.isArray(parsed)) {
      return realEchoTikCreatorLeads;
    }

    return mergeRealCreatorLeads(parsed);
  } catch {
    return realEchoTikCreatorLeads;
  }
}

function rowsFromWorksheet(sheet, utils) {
  const table = utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headerIndex = table.findIndex((row) => {
    const normalizedCells = row.map((cell) => String(cell).trim());
    return normalizedCells.includes("User Id") && normalizedCells.includes("达人名称");
  });

  if (headerIndex < 0) {
    return utils.sheet_to_json(sheet, { defval: "" });
  }

  const headers = table[headerIndex].map((header) => String(header).trim());

  return table.slice(headerIndex + 1)
    .filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""))
    .map((row) =>
      headers.reduce((record, header, index) => {
        if (header) {
          record[header] = row[index] ?? "";
        }
        return record;
      }, {}),
    );
}

const blockedImageHosts = [
  "tiktokcdn.com",
  "tiktokcdn-us.com",
  "tiktok.com",
  "ttwstatic.com",
  "byteimg.com",
  "ibyteimg.com",
  "volces.com",
];

function isBlockedImageUrl(url) {
  if (!url || typeof url !== "string") {
    return true;
  }

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return blockedImageHosts.some((host) => hostname.includes(host));
  } catch {
    return true;
  }
}

function getNextCreatorStage(currentStatus) {
  const currentIndex = creatorFunnelStages.findIndex((stage) => stage.id === currentStatus);

  if (currentIndex < 0 || currentIndex === creatorFunnelStages.length - 1) {
    return currentStatus;
  }

  return creatorFunnelStages[currentIndex + 1].id;
}

async function readCreatorImportFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "xlsx" || extension === "xls") {
    const { read, utils } = await import("xlsx");
    const workbook = read(await file.arrayBuffer(), { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const firstSheet = firstSheetName ? workbook.Sheets[firstSheetName] : null;

    if (!firstSheet) {
      return [];
    }

    return normalizeEchoTikCreatorRows(rowsFromWorksheet(firstSheet, utils), {
      keywords: creatorSearchKeywords,
      sourceName: file.name,
    });
  }

  return parseEchoTikCreatorImport(await file.text(), {
    keywords: creatorSearchKeywords,
    sourceName: file.name,
  });
}

function KpiCard({ title, value, delta, tone, icon: Icon, primary }) {
  return (
    <section className={`kpi-card ${tone} ${primary ? "is-primary" : ""}`}>
      <div>
        <p>{title}</p>
        <strong>{value}</strong>
        <span>较昨日 {delta}</span>
      </div>
      <Icon size={30} strokeWidth={1.8} />
    </section>
  );
}

function Pill({ children, tone = "neutral" }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

function Field({ label, value }) {
  return (
    <div className="detail-field">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

async function writeClipboardText(value) {
  const text = String(value ?? "");
  if (!text) return false;

  if (navigator.clipboard?.writeText) {
    try {
      await Promise.race([
        navigator.clipboard.writeText(text),
        new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error("Clipboard write timed out")), 900);
        }),
      ]);
      return true;
    } catch {
      // Fall through to the textarea copy path for browsers with stricter clipboard permissions.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

function SelectControl({ label, value, options, onChange }) {
  return (
    <label className="select-control">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} />
    </label>
  );
}

function Sidebar({ activeSection, onSelect }) {
  const navItems = getNavigationItems();

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">TK</div>
        <div>
          <strong>TK-SaaS</strong>
          <span>TikTok Shop 管理中台</span>
        </div>
      </div>

      <nav className="nav-list" aria-label="主导航">
        {navItems.map((item) => {
          const Icon = navIconMap[item.id];
          const isActive = item.id === activeSection;

          return (
            <button
              className={`nav-item ${isActive ? "active" : ""}`}
              key={item.id}
              onClick={() => onSelect(item.id)}
              type="button"
            >
              <Icon size={19} strokeWidth={1.9} />
              <span>{item.label}</span>
              {item.id === "orders" ? <em>主任务</em> : null}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <button type="button">
          <ChevronRight size={16} />
          收起
        </button>
      </div>
    </aside>
  );
}

function Topbar({ activeSection, onOpenImport, onSyncEchoTik, isSyncing, lastSync }) {
  const isCreatorPage = activeSection === "creators";

  return (
    <header className="topbar">
      <div className="topbar-title">
        <h1>{isCreatorPage ? "达人线索 CRM" : "今日总览"}</h1>
        <p>
          {isCreatorPage
            ? "EchoTik 导入、粗筛证据、联系方式补充和合作漏斗集中处理。"
            : "订单发货优先，售后和库存风险同步盯紧。"}
        </p>
      </div>
      <div className="topbar-actions">
        <button className="topbar-chip" type="button">
          2026-07-07（周二）
          <Clock3 size={15} />
        </button>
        {isCreatorPage ? (
          <>
            <label className="store-select">
              <select defaultValue="US">
                <option value="US">US 美区</option>
                <option value="MY">MY 马来</option>
                <option value="ID">ID 印尼</option>
              </select>
              <ChevronDown size={15} />
            </label>
            <button
              className={`sync-chip ${isSyncing ? "is-syncing" : ""}`}
              disabled={isSyncing}
              onClick={onSyncEchoTik}
              type="button"
            >
              <span />
              {isSyncing
                ? "同步中..."
                : lastSync
                  ? `上次同步 ${lastSync}`
                  : "EchoTik Open API 同步"}
              <RefreshCw size={15} className={isSyncing ? "spinning" : ""} />
            </button>
            <button className="primary-action" onClick={onOpenImport} type="button">
              <UploadCloud size={18} />
              CSV 导入
            </button>
          </>
        ) : (
          <>
            <label className="store-select">
              <select defaultValue={storeOptions[0]}>
                {storeOptions.map((store) => (
                  <option key={store}>{store}</option>
                ))}
              </select>
              <ChevronDown size={15} />
            </label>
            <button className="sync-chip" type="button">
              <span />
              数据已同步 2 分钟前
              <RefreshCw size={15} />
            </button>
            <button className="primary-action" onClick={onOpenImport} type="button">
              <UploadCloud size={18} />
              开单自动化
            </button>
          </>
        )}
      </div>
    </header>
  );
}

function Dashboard({
  filters,
  groupedTasks,
  metrics,
  onFilterChange,
  onSelectTask,
  selectedTaskId,
  taskCount,
}) {
  return (
    <main className="content">
      <section className="kpi-grid" aria-label="今日指标">
        <KpiCard
          delta={formatMetricDelta(8)}
          icon={Bell}
          title="紧急任务总数"
          tone="red"
          value={metrics.urgentOpenTasks}
        />
        <KpiCard
          delta={formatMetricDelta(6)}
          icon={Truck}
          primary
          title="订单发货工作量"
          tone="teal"
          value={metrics.shippingWorkload}
        />
        <KpiCard
          delta={formatMetricDelta(4)}
          icon={AlertTriangle}
          title="24h揽收风险"
          tone="orange"
          value={metrics.pickupRisk}
        />
        <KpiCard
          delta={formatMetricDelta(3, "down")}
          icon={Headphones}
          title="售后待处理"
          tone="blue"
          value={metrics.aftersalesOpen}
        />
        <KpiCard
          delta={formatMetricDelta(2)}
          icon={Archive}
          title="库存异常"
          tone="amber"
          value={metrics.inventoryExceptions}
        />
        <KpiCard
          delta={formatMetricDelta(1)}
          icon={Star}
          title="差评跟进"
          tone="red-soft"
          value={metrics.badReviewFollowUp}
        />
      </section>

      <section className="task-surface">
        <div className="surface-toolbar">
          <div className="tabs">
            <button className="active" type="button">
              任务指挥台
            </button>
            <button type="button">全部任务</button>
          </div>
          <div className="filters">
            <SelectControl
              label="任务类型"
              onChange={(value) => onFilterChange("module", value)}
              options={filterModules}
              value={filters.module}
            />
            <SelectControl
              label="优先级"
              onChange={(value) => onFilterChange("priority", value)}
              options={filterPriorities}
              value={filters.priority}
            />
            <button className="filter-button" type="button">
              <Filter size={16} />
              筛选
            </button>
          </div>
        </div>

        <div className="task-table" role="table" aria-label="每日任务">
          <div className="table-head" role="row">
            <span>任务</span>
            <span>来源</span>
            <span>优先级</span>
            <span>截止时间</span>
            <span>自动化动作</span>
            <span>状态</span>
          </div>
          {groupedTasks.map((group) => (
            <section className="shift-group" key={group.id}>
              <button className="group-title" type="button">
                <ChevronDown size={16} />
                <span>{group.title}</span>
                <em>{group.tasks.length}</em>
              </button>
              {group.tasks.map((task) => {
                const ModuleIcon = moduleMeta[task.module]?.icon ?? Inbox;
                const isSelected = task.id === selectedTaskId;

                return (
                  <button
                    className={`task-row ${isSelected ? "selected" : ""} ${
                      task.module === "orders" ? "shipping-row" : ""
                    }`}
                    key={task.id}
                    onClick={() => onSelectTask(task.id)}
                    role="row"
                    type="button"
                  >
                    <span className="task-title">
                      <ModuleIcon size={17} />
                      {task.title}
                    </span>
                    <span>{task.source}</span>
                    <span>
                      <Pill tone={priorityTone[task.priority]}>
                        {getPriorityLabel(task.priority)}
                      </Pill>
                    </span>
                    <span className={task.priority === "urgent" ? "urgent-time" : ""}>
                      {task.dueLabel}
                    </span>
                    <span>{task.automationAction}</span>
                    <span>
                      <Pill tone={statusTone[task.status]}>{getStatusLabel(task.status)}</Pill>
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
        </div>

        <footer className="table-footer">
          <span>共 {taskCount} 条任务</span>
          <div>
            <button disabled type="button">
              <ChevronRight size={16} />
            </button>
            <button className="page-current" type="button">
              1
            </button>
            <button type="button">2</button>
            <button type="button">
              <ChevronRight size={16} />
            </button>
            <select defaultValue="20">
              <option value="20">20 条/页</option>
              <option value="50">50 条/页</option>
            </select>
          </div>
        </footer>
      </section>
    </main>
  );
}

function ModulePage({ moduleId, tasks, onSelectTask, selectedTaskId }) {
  const meta = moduleMeta[moduleId];
  const Icon = meta?.icon ?? Inbox;
  const activeTasks = tasks.filter((task) => task.module === moduleId);
  const openCount = activeTasks.filter((task) => task.status !== "done").length;

  return (
    <main className="content module-page">
      <section className={`module-hero tone-${meta?.tone ?? "teal"}`}>
        <div>
          <p>{moduleId === "orders" ? "主工作区" : "模块工作区"}</p>
          <h2>
            <Icon size={27} />
            {meta?.label}
          </h2>
          <span>
            {moduleId === "orders"
              ? "每日工作量最大，系统自动处理开单、发货信息、确认页和揽收跟进。"
              : "从今日任务池里抽取本模块事项，在当前 SaaS 内触发自动化处理。"}
          </span>
        </div>
        <strong>{openCount}</strong>
      </section>

      <section className="module-layout">
        <div className="module-list">
          <div className="module-toolbar">
            <h3>{moduleId === "orders" ? "发货待办队列" : "待办队列"}</h3>
            <button type="button">
              <Search size={16} />
              搜索
            </button>
          </div>
          {activeTasks.map((task) => (
            <button
              className={`module-row ${task.id === selectedTaskId ? "selected" : ""}`}
              key={task.id}
              onClick={() => onSelectTask(task.id)}
              type="button"
            >
              <div>
                <strong>{task.title}</strong>
                <span>{task.summary}</span>
              </div>
              <Pill tone={priorityTone[task.priority]}>{getPriorityLabel(task.priority)}</Pill>
            </button>
          ))}
        </div>
        <div className="module-notes">
          <h3>{moduleId === "orders" ? "发货检查重点" : "处理原则"}</h3>
          <ul>
            {moduleId === "orders" ? (
              <>
                <li>先看距离 24h 揽收最近的订单。</li>
                <li>M店 ST&BW 下单当天必须联系客户。</li>
                <li>送达 3 天后只能邀请真实体验反馈。</li>
                <li>下班前复核面单、揽收、异常备注。</li>
              </>
            ) : (
              <>
                <li>所有任务默认变成可触发的自动化动作。</li>
                <li>系统负责打开页面、填写、上传、回写状态。</li>
                <li>高风险步骤在当前系统内保留确认点，不让人来回切网页。</li>
              </>
            )}
          </ul>
        </div>
      </section>
    </main>
  );
}

function CreatorMetric({ label, value, hint }) {
  return (
    <div className="creator-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function CoverImage({ creator }) {
  const [failed, setFailed] = useState(false);
  const src = getCreatorCover(creator);
  const initials = (creator.displayName || "?").slice(0, 2).toUpperCase();

  if (!src || isBlockedImageUrl(src) || failed) {
    return (
      <div className="creator-cover-fallback" aria-label={creator.displayName}>
        {initials}
      </div>
    );
  }

  return (
    <img
      alt={creator.displayName}
      referrerPolicy="no-referrer"
      src={src}
      onError={() => setFailed(true)}
    />
  );
}

function CreatorTableRow({ creator, isSelected, onCopy, onSelect, onStar }) {
  const flag = getCountryFlag(creator.region);

  return (
    <div
      className={`creator-table-row ${isSelected ? "selected" : ""}`}
      onClick={() => onSelect(creator.id)}
      role="button"
      tabIndex={0}
    >
      <div className="creator-cell creator-cell-name">
        <div className="creator-avatar">
          <CoverImage creator={creator} />
        </div>
        <div className="creator-name-meta">
          <strong>{creator.displayName}</strong>
          <span>
            @{creator.handle}
            <button
              className="creator-copy"
              onClick={(event) => {
                event.stopPropagation();
                onCopy(creator.handle);
              }}
              title="复制 TikTok 账号"
              type="button"
            >
              <Copy size={12} />
            </button>
          </span>
          <div className="creator-name-badges">
            {flag ? <span className="creator-flag" title={creator.region}>{flag}</span> : null}
            {creator.contact?.email ? (
              <span className="creator-email-badge" title={creator.contact.email}>
                <Mail size={12} />
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="creator-cell creator-cell-number">{formatCompactNumber(creator.followers)}</div>
      <div className="creator-cell creator-cell-number creator-cell-highlight">
        {formatCompactNumber(creator.followerGrowth30d)}
      </div>
      <div className="creator-cell creator-cell-number">{formatDecimal(creator.likesFollowerRatio)}</div>
      <div className="creator-cell creator-cell-number">
        {formatCompactNumber(creator.totalVideoCount || creator.recentVideos?.length || 0)}
      </div>
      <div className="creator-cell creator-cell-number">{formatCompactNumber(creator.avgViews30d)}</div>
      <div className="creator-cell creator-cell-number">{formatPercent(creator.er)}</div>
      <div className="creator-cell creator-cell-number">{formatCompactNumber(creator.totalProductCnt || creator.productAssociatedVideos?.length || 0)}</div>
      <div className="creator-cell creator-cell-action">
        <button
          className={`creator-star ${creator.starred ? "starred" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onStar(creator.id);
          }}
          title={creator.starred ? "取消收藏" : "收藏"}
          type="button"
        >
          <Star size={18} fill={creator.starred ? "currentColor" : "none"} />
        </button>
      </div>
    </div>
  );
}

function CreatorPage({
  creators,
  filters,
  onClearImported,
  onCopyHandle,
  onFilterChange,
  onImport,
  onSelectCreator,
  onStarToggle,
  selectedCreatorId,
}) {
  const metrics = calculateCreatorMetrics(creators, creatorNow);
  const visibleCreators = filterCreatorLeads(creators, filters, creatorNow);
  const statusOptions = [
    { value: "all", label: "全部状态" },
    ...creatorFunnelStages.map((stage) => ({ value: stage.id, label: stage.label })),
  ];
  const keywordOptions = [
    { value: "all", label: "全部关键词" },
    ...creatorSearchKeywords.map((keyword) => ({ value: keyword, label: keyword })),
  ];

  return (
    <main className="content creator-page">
      <section className="creator-command">
        <div>
          <p>EchoTik 第一波粗筛</p>
          <h2>高播放封面 + CRM 漏斗</h2>
          <span>
            粉丝&gt;1000、近10条至少6条播放&gt;1000、30天内更新、商品关联视频和关键词命中。
          </span>
        </div>
        <div className="creator-command-actions">
          <button className="primary-action" onClick={onImport} type="button">
            <UploadCloud size={18} />
            导入 CSV/Excel
          </button>
          <button className="danger-action" onClick={onClearImported} type="button">
            <X size={18} />
            清空导入
          </button>
        </div>
      </section>

      <section className="creator-metrics" aria-label="达人粗筛指标">
        <CreatorMetric hint="EchoTik 本批次" label="导入达人" value={metrics.imported} />
        <CreatorMetric hint="规则全部通过" label="粗筛通过" value={metrics.qualified} />
        <CreatorMetric hint="主页人工补充" label="待补联系方式" value={metrics.needsContact} />
        <CreatorMetric hint="可进入复盘" label="已发布" value={metrics.published} />
      </section>

      <section className="creator-keywords">
        <strong>搜索关键词</strong>
        <div>
          {creatorSearchKeywords.map((keyword) => (
            <span key={keyword}>{keyword}</span>
          ))}
        </div>
      </section>

      <section className="creator-toolbar">
        <div className="creator-search">
          <Search size={16} />
          <input
            onChange={(event) => onFilterChange("search", event.target.value)}
            placeholder="搜索达人、ID、描述"
            value={filters.search}
          />
        </div>
        <SelectControl
          label="漏斗"
          onChange={(value) => onFilterChange("status", value)}
          options={statusOptions}
          value={filters.status}
        />
        <SelectControl
          label="关键词"
          onChange={(value) => onFilterChange("keyword", value)}
          options={keywordOptions}
          value={filters.keyword}
        />
        <SelectControl
          label="证据"
          onChange={(value) => onFilterChange("qualification", value)}
          options={[
            { value: "all", label: "全部证据" },
            { value: "qualified", label: "粗筛通过" },
            { value: "needs_review", label: "需复核" },
          ]}
          value={filters.qualification}
        />
      </section>

      <section className="creator-table" aria-label="达人列表">
        <div className="creator-table-head">
          <div className="creator-cell creator-cell-name">达人</div>
          <div className="creator-cell creator-cell-number">粉丝数</div>
          <div className="creator-cell creator-cell-number">30天涨粉数</div>
          <div className="creator-cell creator-cell-number">获赞数/粉丝数</div>
          <div className="creator-cell creator-cell-number">视频数</div>
          <div className="creator-cell creator-cell-number">30日平均播放量</div>
          <div className="creator-cell creator-cell-number">30日ER互动率</div>
          <div className="creator-cell creator-cell-number">带货商品数</div>
          <div className="creator-cell creator-cell-action">操作</div>
        </div>
        <div className="creator-table-body">
          {visibleCreators.length > 0 ? (
            visibleCreators.map((creator) => (
              <CreatorTableRow
                creator={creator}
                isSelected={creator.id === selectedCreatorId}
                key={creator.id}
                onCopy={onCopyHandle}
                onSelect={onSelectCreator}
                onStar={onStarToggle}
              />
            ))
          ) : (
            <div className="creator-empty-state">
              <Users size={24} />
              <strong>还没有真实达人数据</strong>
              <span>点击 EchoTik 同步，或导入 EchoTik CSV / Excel / JSON 后开始粗筛。</span>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function DrawerCoverImage({ creator }) {
  const [failed, setFailed] = useState(false);
  const src = getCreatorCover(creator);
  const initials = (creator.displayName || "?").slice(0, 2).toUpperCase();

  if (!src || isBlockedImageUrl(src) || failed) {
    return (
      <div className="drawer-cover-fallback" aria-label={creator.displayName}>
        {initials}
      </div>
    );
  }

  return (
    <img
      alt={`${creator.displayName} 达人图片`}
      referrerPolicy="no-referrer"
      src={src}
      onError={() => setFailed(true)}
    />
  );
}

function VideoCoverImage({ video, creator }) {
  const [failed, setFailed] = useState(false);
  const src = video.coverUrl || creator.highPerformingCoverUrl || "";

  if (!src || isBlockedImageUrl(src) || failed) {
    return (
      <div className="creator-video-cover-fallback">
        <Film size={24} />
      </div>
    );
  }

  return (
    <img
      alt={video.title || video.description || `${creator.displayName} video`}
      referrerPolicy="no-referrer"
      src={src}
      onError={() => setFailed(true)}
    />
  );
}

function CreatorVideoList({ creator }) {
  const videos = (creator.recentVideos ?? []).filter(
    (video) => video && (video.videoUrl || video.shareUrl || video.videoId || video.id || video.coverUrl || video.views),
  );

  if (creator.videoDetailsLoading) {
    return (
      <div className="creator-video-empty">
        <RefreshCw size={18} className="spinning" />
        正在从 EchoTik 拉取该达人的真实视频明细
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="creator-video-empty">
        <ImageOff size={18} />
        {creator.rawId
          ? "EchoTik 视频接口暂未返回该达人视频；仍保留真实达人资料，等待重试或导入视频导出文件。"
          : "当前文件没有导入视频明细；需要 EchoTik 视频导出列或 Open API 同步后才能打开视频。"}
      </div>
    );
  }

  return (
    <div className="creator-video-list">
      {videos.slice(0, 10).map((video, index) => {
        const videoUrl = getVideoUrl(video, creator);
        const hasProducts =
          video.hasProducts || (video.productIds ?? []).length > 0 || Number(video.salesCount ?? 0) > 0;
        const title = video.title || video.description || `视频 ${index + 1}`;

        return (
          <a
            className={`creator-video-card ${videoUrl ? "" : "disabled"}`}
            href={videoUrl || undefined}
            key={video.id || video.videoId || index}
            onClick={(event) => {
              if (!videoUrl) event.preventDefault();
            }}
            rel="noreferrer"
            target="_blank"
          >
            <div className="creator-video-cover">
              <VideoCoverImage creator={creator} video={video} />
            </div>
            <div className="creator-video-info">
              <strong title={title}>{title}</strong>
              <div className="creator-video-meta">
                <span>
                  <Eye size={13} />
                  {formatCompactNumber(Number(video.views ?? 0))}
                </span>
                <span>
                  <Clock3 size={13} />
                  {formatShortDate(video.createDate)}
                </span>
                {hasProducts ? (
                  <span className="commerce">
                    <ShoppingBag size={13} />
                    带货
                  </span>
                ) : null}
              </div>
              <em>
                {videoUrl ? "打开 TikTok 视频" : "缺少视频链接 / video_id"}
                <ExternalLink size={13} />
              </em>
            </div>
          </a>
        );
      })}
    </div>
  );
}

function CreatorDetailDrawer({
  creator,
  isAutomationRunning,
  onConfirmOutreachDraft,
  onContactChange,
  onCopyOutreachDraft,
  onQueueOutreachDraft,
  onRecordOutreachSent,
  onStatusChange,
}) {
  if (!creator) {
    return (
      <aside className="detail-drawer empty">
        <Users size={28} />
        <strong>选择一个达人</strong>
        <span>右侧会显示粗筛证据、联系方式补充和 CRM 状态。</span>
      </aside>
    );
  }

  const evaluation = evaluateCreatorLead(creator, creatorNow);
  const profileUrl = buildTikTokProfileUrl(creator.profileUrl ?? creator.handle);
  const instagramUrl = getInstagramProfileUrl(creator);
  const nextStage = getNextCreatorStage(creator.crmStatus);
  const outreach = creator.automation?.outreach;
  const outreachStatus = outreach?.status || "not_started";
  const canConfirmDraft = outreachStatus === "draft_ready" && Boolean(outreach?.draft);
  const canRecordSent = outreachStatus === "confirmed";
  const checklist = [
    ["打开 TikTok 主页", Boolean(profileUrl)],
    ["确认公开邮箱", Boolean(creator.contact?.email)],
    ["确认 Instagram / Linktree", Boolean(instagramUrl)],
    ["确认内容符合黑人女性发型类目", evaluation.keywordCount > 0],
    ["确认曾带货 / 商品关联", evaluation.productVideoCount > 0],
  ];

  return (
    <aside className="detail-drawer creator-drawer">
      <div className="drawer-head">
        <div>
          <h2>{creator.displayName}</h2>
          <Pill tone={creatorStatusTone[creator.crmStatus]}>
            {getCreatorStatusLabel(creator.crmStatus)}
          </Pill>
        </div>
        <a aria-label="打开 TikTok 主页" href={profileUrl} rel="noreferrer" target="_blank">
          <ExternalLink size={18} />
        </a>
      </div>

      <div className="drawer-body">
        <section className="creator-drawer-cover">
          <DrawerCoverImage creator={creator} />
        </section>

        <section className="drawer-section">
          <div className="section-title-row">
            <h3>真实视频明细</h3>
            <Pill tone={creator.recentVideos?.length ? "processing" : "neutral"}>
              {creator.recentVideos?.length ? `${creator.recentVideos.length} 条` : "待拉取"}
            </Pill>
          </div>
          <CreatorVideoList creator={creator} />
        </section>

        <section className="drawer-section">
          <h3>达人数据</h3>
          <dl>
            <Field label="TikTok ID" value={`@${creator.handle}`} />
            <Field label="地区" value={creator.region || "--"} />
            <Field label="品类" value={creator.category || "--"} />
            <Field label="粉丝数" value={formatCompactNumber(evaluation.followers)} />
            <Field label="30天GMV" value={formatCurrency(creator.gmv30d)} />
            <Field label="总销售额" value={formatCurrency(creator.salesGmv)} />
            <Field label="总销量" value={formatCompactNumber(creator.salesCount)} />
            <Field label="视频销售额" value={formatCurrency(creator.videoSalesGmv)} />
            <Field label="直播销售额" value={formatCurrency(creator.liveSalesGmv)} />
            <Field label="互动率 (ER)" value={formatPercent(creator.er)} />
            <Field label="平均播放 (30天)" value={formatCompactNumber(creator.avgViews30d)} />
            <Field label="播放稳定" value={`${evaluation.stableVideoCount}/10 条视频 > 1000`} />
            <Field
              label="最近发布"
              value={
                evaluation.daysSinceLastPost === null
                  ? "缺发布时间"
                  : `${evaluation.daysSinceLastPost} 天前`
              }
            />
            <Field label="带货证据" value={`${evaluation.productVideoCount} 项`} />
            <Field label="社交账号" value={creator.contact?.socialAccount || "--"} />
            <Field label="Instagram" value={instagramUrl ? "已识别主页链接" : "--"} />
            <Field label="来源" value={creator.source} />
          </dl>
          {creator.sourceDataWarnings?.length ? (
            <div className="source-warnings">
              {creator.sourceDataWarnings.map((warning) => (
                <span key={warning}>
                  <AlertTriangle size={13} />
                  {warning}
                </span>
              ))}
            </div>
          ) : null}
        </section>

        <section className="drawer-section">
          <h3>命中关键词</h3>
          <div className="keyword-chips drawer-keywords">
            {creator.matchedKeywords.map((keyword) => (
              <span key={keyword}>{keyword}</span>
            ))}
          </div>
        </section>

        <section className="drawer-section">
          <h3>联系方式补充</h3>
          <div className="contact-fields">
            <label>
              <span>Email</span>
              <input
                onChange={(event) => onContactChange(creator.id, "email", event.target.value)}
                placeholder="主页公开邮箱"
                value={creator.contact?.email ?? ""}
              />
            </label>
            <label>
              <span>Instagram</span>
              <input
                onChange={(event) => onContactChange(creator.id, "instagram", event.target.value)}
                placeholder="主页公开 IG / Linktree"
                value={creator.contact?.instagram ?? ""}
              />
            </label>
            <label>
              <span>备注</span>
              <textarea
                onChange={(event) => onContactChange(creator.id, "notes", event.target.value)}
                value={creator.contact?.notes ?? ""}
              />
            </label>
          </div>
          {instagramUrl ? (
            <div className="contact-quick-actions">
              <a className="inline-automation secondary" href={instagramUrl} rel="noreferrer" target="_blank">
                <ExternalLink size={16} />
                打开 Instagram 主页
              </a>
            </div>
          ) : null}
        </section>

        <section className="drawer-section">
          <h3>人工检查清单</h3>
          <div className="checklist">
            {checklist.map(([label, checked]) => (
              <span className={checked ? "checked" : ""} key={label}>
                <Check size={14} />
                {label}
              </span>
            ))}
          </div>
        </section>

        <section className="drawer-section">
          <h3>CRM 状态</h3>
          <div className="funnel-actions">
            {creatorFunnelStages.map((stage) => (
              <button
                className={stage.id === creator.crmStatus ? "active" : ""}
                key={stage.id}
                onClick={() => onStatusChange(creator.id, stage.id)}
                type="button"
              >
                {stage.label}
              </button>
            ))}
          </div>
        </section>

        <section className="drawer-section script-section ai-reserved">
          <div className="section-title-row">
            <h3>AI 第一波沟通</h3>
            <Pill tone={creatorAutomationTone[outreachStatus] ?? "neutral"}>
              {getCreatorAutomationLabel(outreachStatus)}
            </Pill>
          </div>
          <div className="outreach-status-grid">
            <Field label="执行模式" value="Dry-run 草稿，不自动发送" />
            <Field label="联系渠道" value={creator.contact?.email ? "Email" : instagramUrl ? "Instagram" : "人工补充"} />
            <Field label="队列来源" value={outreach?.source || "待提交"} />
            <Field label="队列 ID" value={outreach?.queueId || "--"} />
            <Field label="确认时间" value={outreach?.confirmedAt ? formatShortDate(outreach.confirmedAt) : "--"} />
            <Field label="发送回写" value={outreach?.sentAt ? formatShortDate(outreach.sentAt) : "--"} />
            <Field
              label="Chatwoot"
              value={
                outreach?.chatwoot?.contactId
                  ? `Contact #${outreach.chatwoot.contactId}`
                  : outreach?.chatwoot?.status || "--"
              }
            />
            <Field label="更新时间" value={outreach?.updatedAt ? formatShortDate(outreach.updatedAt) : "--"} />
          </div>
          {outreach?.draft ? (
            <pre className="outreach-draft">{outreach.draft}</pre>
          ) : (
            <p>点击生成草稿后，系统会把达人证据和联系方式写入本地队列；如配置 n8n webhook，会同步请求 n8n 生成草稿。</p>
          )}
          {outreach?.error ? <p className="outreach-error">{outreach.error}</p> : null}
          <div className="outreach-action-row">
            {instagramUrl ? (
              <a className="inline-automation secondary" href={instagramUrl} rel="noreferrer" target="_blank">
                <ExternalLink size={16} />
                打开 IG 主页
              </a>
            ) : null}
            {instagramUrl && outreach?.draft ? (
              <button
                className="inline-automation secondary"
                onClick={() => onCopyOutreachDraft(creator.id)}
                type="button"
              >
                <Copy size={16} />
                复制 IG 草稿
              </button>
            ) : null}
            <button
              className="inline-automation"
              disabled={isAutomationRunning}
              onClick={() => onQueueOutreachDraft(creator.id)}
              type="button"
            >
              <Sparkles size={16} />
              {isAutomationRunning ? "提交中" : "生成联系草稿"}
            </button>
            {canConfirmDraft ? (
              <button
                className="inline-automation secondary"
                disabled={isAutomationRunning}
                onClick={() => onConfirmOutreachDraft(creator.id)}
                type="button"
              >
                <Check size={16} />
                人工确认草稿
              </button>
            ) : null}
            {canRecordSent ? (
              <button
                className="inline-automation secondary"
                disabled={isAutomationRunning}
                onClick={() => onRecordOutreachSent(creator.id)}
                type="button"
              >
                <Send size={16} />
                确认已发送并回写
              </button>
            ) : null}
          </div>
        </section>
      </div>

      <div className="drawer-actions">
        <button onClick={() => onStatusChange(creator.id, nextStage)} type="button">
          <ClipboardCheck size={17} />
          推进下一步
        </button>
        <button onClick={() => onStatusChange(creator.id, "ready_to_contact")} type="button">
          <Check size={18} />
          联系方式已确认
        </button>
        <button disabled={isAutomationRunning} onClick={() => onQueueOutreachDraft(creator.id)} type="button">
          <Sparkles size={17} />
          {isAutomationRunning ? "提交中" : "生成草稿"}
        </button>
      </div>
    </aside>
  );
}

function SettingsPage() {
  return (
    <main className="content module-page">
      <section className="settings-grid">
        <div className="settings-panel">
          <h2>API 接入策略</h2>
          <p>第一版页面调用 TK-SaaS 自己的 API，外部平台通过适配器逐步接入。</p>
          <div className="lane-list">
            {apiLanes.map((lane) => (
              <div className="lane" key={lane.title}>
                <strong>{lane.title}</strong>
                <span>{lane.description}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="settings-panel">
          <h2>n8n 自动化预留</h2>
          <p>n8n 负责定时任务、Webhook、通知和草稿流程，不负责主数据状态。</p>
          <div className="automation-list">
            {automationEvents.map((event) => (
              <div key={event.id}>
                <span>{event.time}</span>
                <strong>{event.label}</strong>
                <Pill tone={event.status === "ready" ? "done" : "warning"}>
                  {event.status === "ready" ? "就绪" : "待触发"}
                </Pill>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function DetailDrawer({ task, onRunAutomation, onSendScript, onUpdateStatus }) {
  if (!task) {
    return (
      <aside className="detail-drawer empty">
        <Inbox size={28} />
        <strong>选择一个任务</strong>
        <span>右侧会显示处理信息、建议动作和话术草稿。</span>
      </aside>
    );
  }

  return (
    <aside className="detail-drawer">
      <div className="drawer-head">
        <div>
          <h2>{task.title}</h2>
          <Pill tone={priorityTone[task.priority]}>{getPriorityLabel(task.priority)}</Pill>
        </div>
        <button aria-label="关闭详情" type="button">
          <X size={18} />
        </button>
      </div>

      <div className="drawer-body">
        <section className="drawer-section">
          <h3>基础信息</h3>
          <dl>
            {task.details.map(([label, value]) => (
              <Field key={label} label={label} value={value} />
            ))}
          </dl>
        </section>

        <section className="drawer-section">
          <h3>问题说明</h3>
          <p>{task.summary}</p>
        </section>

        <section className="drawer-section automation-section">
          <div className="section-title-row">
            <h3>自动化动作</h3>
            <Pill tone="processing">可执行</Pill>
          </div>
          <p>{task.automationAction}</p>
          <button className="inline-automation" onClick={() => onRunAutomation(task.id)} type="button">
            <Sparkles size={16} />
            一键执行
          </button>
        </section>

        <section className="drawer-section script-section">
          <div className="section-title-row">
            <h3>{task.scriptTitle}</h3>
            <button onClick={() => onSendScript(task.id)} type="button">
              <Send size={15} />
              一键发送
            </button>
          </div>
          <p>{task.script}</p>
          <footer>
            <span>适用场景：{moduleMeta[task.module]?.label ?? "任务处理"}</span>
            <span>共 {task.script.length} 字</span>
          </footer>
        </section>
      </div>

      <div className="drawer-actions">
        <button onClick={() => onRunAutomation(task.id)} type="button">
          <ClipboardCheck size={17} />
          启动自动化
        </button>
        <button onClick={() => onSendScript(task.id)} type="button">
          <Send size={17} />
          一键发送
        </button>
        <button className="complete" onClick={() => onUpdateStatus(task.id, "done")} type="button">
          <Check size={18} />
          完成
        </button>
      </div>
    </aside>
  );
}

function ImportModal({ onClose, onCreatorImport, variant = "operations" }) {
  const isCreatorImport = variant === "creators";
  const [importError, setImportError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const lanes = isCreatorImport
    ? [
        {
          title: "EchoTik CSV / Excel",
          description: "导入 userId、粉丝数、近几条视频播放量、发布时间、视频封面和商品关联视频。",
        },
        {
          title: "字段缺失兜底",
          description: "缺封面、缺视频或缺商品关联时保留达人，并在卡片和详情里标出证据缺口。",
        },
        {
          title: "联系方式来源",
          description: "EchoTik API 已接入，达人公开邮箱（contact_email）自动同步。Instagram/WhatsApp 需人工从主页补充。",
        },
        {
          title: "AI 沟通预留",
          description: "第一版不自动发送。后续在联系方式确认后生成首轮寄样或 affiliate 草稿。",
        },
      ]
    : apiLanes;

  async function handleCreatorFileChange(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setImportError("");
    setIsImporting(true);

    try {
      const importedCreators = await readCreatorImportFile(file);

      if (importedCreators.length === 0) {
        throw new Error("没有识别到 EchoTik 达人行，请检查文件是否包含 UID / Influencer / TikTok ID 等表头。");
      }

      onCreatorImport(importedCreators, file.name);
      onClose();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "导入失败，请换 CSV/Excel 再试。");
    } finally {
      setIsImporting(false);
      event.target.value = "";
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="modal-head">
          <div>
            <p>{isCreatorImport ? "达人数据入口" : "数据入口"}</p>
            <h2 id="import-title">
              {isCreatorImport ? "EchoTik 导入 / 粗筛 / CRM" : "开单自动化 / RPA / n8n"}
            </h2>
          </div>
          <button aria-label="关闭导入弹窗" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>
        <div className="import-lanes">
          {lanes.map((lane) => (
            <div key={lane.title}>
              <FileSpreadsheet size={20} />
              <strong>{lane.title}</strong>
              <span>{lane.description}</span>
            </div>
          ))}
        </div>
        {importError ? (
          <p className="import-error" role="alert">
            {importError}
          </p>
        ) : null}
        <footer className="modal-actions">
          <button onClick={onClose} type="button">
            取消
          </button>
          {isCreatorImport ? (
            <label className={`primary-action file-action ${isImporting ? "disabled" : ""}`}>
              <UploadCloud size={17} />
              {isImporting ? "导入中" : "选择 EchoTik 文件"}
              <input
                accept=".csv,.tsv,.json,.xlsx,.xls"
                disabled={isImporting}
                onChange={handleCreatorFileChange}
                type="file"
              />
            </label>
          ) : (
            <button className="primary-action" onClick={onClose} type="button">
              <UploadCloud size={17} />
              选择文件
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

export function App() {
  const [activeSection, setActiveSection] = useState("dashboard");
  const [taskList, setTaskList] = useState(initialTasks);
  const [creatorList, setCreatorList] = useState(loadSavedCreatorLeads);
  const [selectedTaskId, setSelectedTaskId] = useState(initialTasks[0]?.id);
  const [selectedCreatorId, setSelectedCreatorId] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [toastState, setToastState] = useState(null);
  const [filters, setFilters] = useState({
    module: "all",
    priority: "all",
    status: "all",
  });
  const [creatorFilters, setCreatorFilters] = useState({
    status: "all",
    keyword: "all",
    qualification: "all",
    search: "",
  });
  const [creatorAutomationBusyId, setCreatorAutomationBusyId] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState("");

  const metrics = useMemo(() => calculateDashboardMetrics(taskList), [taskList]);
  const visibleTasks = useMemo(() => filterTasks(taskList, filters), [taskList, filters]);
  const groupedTasks = useMemo(() => groupTasksByShift(visibleTasks), [visibleTasks]);
  const selectedTask = taskList.find((task) => task.id === selectedTaskId) ?? taskList[0];
  const selectedCreator =
    creatorList.find((creator) => creator.id === selectedCreatorId) ?? creatorList[0];

  useEffect(() => {
    setCreatorList((current) => mergeRealCreatorLeads(current));
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(creatorStorageKey, JSON.stringify(creatorList));
    } catch {
      // Local persistence is helpful but not required for the workbench to run.
    }
  }, [creatorList]);

  useEffect(() => {
    if (creatorList.length === 0) {
      return undefined;
    }

    const backupTimer = window.setTimeout(() => {
      fetch("/api/local/creator-backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "tk-saas-creator-workbench",
          creators: creatorList,
        }),
      }).catch(() => {
        // Disk backup is best-effort in dev; localStorage still preserves the UI state.
      });
    }, 700);

    return () => window.clearTimeout(backupTimer);
  }, [creatorList]);

  useEffect(() => {
    if (creatorList.length === 0) {
      if (selectedCreatorId) {
        setSelectedCreatorId(null);
      }
      return;
    }

    if (!selectedCreatorId || !creatorList.some((creator) => creator.id === selectedCreatorId)) {
      setSelectedCreatorId(creatorList[0].id);
    }
  }, [creatorList, selectedCreatorId]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function updateTaskStatus(taskId, status) {
    setTaskList((current) =>
      current.map((task) => (task.id === taskId ? { ...task, status } : task)),
    );
  }

  function updateCreatorFilter(key, value) {
    setCreatorFilters((current) => ({ ...current, [key]: value }));
  }

  function updateCreatorCrmStatus(creatorId, status) {
    setCreatorList((current) => updateCreatorStatus(current, creatorId, status));
    showToast(`达人状态已更新为：${getCreatorStatusLabel(status)}`);
  }

  function updateCreatorContact(creatorId, field, value) {
    setCreatorList((current) =>
      current.map((creator) =>
        creator.id === creatorId
          ? {
              ...creator,
              contact: {
                ...creator.contact,
                [field]: value,
              },
            }
          : creator,
      ),
    );
  }

  async function submitCreatorAutomationAction(creatorId, payload, pendingResult, successMessage, failurePrefix) {
    const creator = creatorList.find((item) => item.id === creatorId);

    if (!creator || creatorAutomationBusyId) {
      return;
    }

    setCreatorAutomationBusyId(creatorId);
    setCreatorList((current) =>
      applyCreatorAutomationResult(current, creatorId, {
        ...pendingResult,
        status: pendingResult.status || "queueing",
        source: "tk-saas-web",
        requestedAt: payload.requestedAt,
        updatedAt: payload.requestedAt,
      }),
    );

    try {
      const response = await fetch("/api/local/creator-automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.ok === false) {
        throw new Error(result.message || "达人联系自动化提交失败");
      }

      setCreatorList((current) =>
        applyCreatorAutomationResult(current, creatorId, {
          ...result,
          requestedAt: payload.requestedAt,
        }),
      );
      showToast(typeof successMessage === "function" ? successMessage(result) : successMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : `${failurePrefix}失败`;
      setCreatorList((current) =>
        applyCreatorAutomationResult(current, creatorId, {
          status: "failed",
          source: "tk-saas-web",
          error: message,
          requestedAt: payload.requestedAt,
          updatedAt: new Date().toISOString(),
          dryRun: true,
          allowSend: false,
        }),
      );
      showToast(`${failurePrefix}失败：${message}`, "failed");
    } finally {
      setCreatorAutomationBusyId(null);
    }
  }

  async function queueCreatorOutreachDraft(creatorId) {
    const creator = creatorList.find((item) => item.id === creatorId);
    if (!creator) return;

    const requestedAt = new Date().toISOString();
    const payload = buildCreatorAutomationPayload(creator, { requestedAt });

    await submitCreatorAutomationAction(
      creatorId,
      payload,
      {
        status: "queueing",
        dryRun: true,
        allowSend: false,
      },
      (result) => (result.n8nConfigured ? "n8n 草稿已生成并回写" : "Dry-run 草稿已生成，队列已落盘"),
      "草稿生成",
    );
  }

  async function confirmCreatorOutreachDraft(creatorId) {
    const creator = creatorList.find((item) => item.id === creatorId);
    const draft = creator?.automation?.outreach?.draft;
    if (!creator || !draft) {
      showToast("请先生成草稿", "failed");
      return;
    }

    const requestedAt = new Date().toISOString();
    const confirmedAt = requestedAt;
    const payload = buildCreatorAutomationPayload(creator, {
      action: "confirm",
      requestedAt,
      confirmedAt,
      confirmedBy: "operator",
      draft,
    });

    await submitCreatorAutomationAction(
      creatorId,
      payload,
      {
        status: "queueing",
        dryRun: true,
        allowSend: false,
      },
      "草稿已人工确认",
      "草稿确认",
    );
  }

  async function recordCreatorOutreachSent(creatorId) {
    const creator = creatorList.find((item) => item.id === creatorId);
    const outreach = creator?.automation?.outreach;
    if (!creator || outreach?.status !== "confirmed" || !outreach?.confirmedAt) {
      showToast("请先人工确认草稿", "failed");
      return;
    }

    const requestedAt = new Date().toISOString();
    const payload = buildCreatorAutomationPayload(creator, {
      action: "record_sent",
      allowSend: true,
      channel: creator.contact?.email ? "email" : getInstagramProfileUrl(creator) ? "instagram" : "manual",
      requestedAt,
      confirmedAt: outreach.confirmedAt,
      confirmedBy: outreach.confirmedBy || "operator",
      draft: outreach.draft,
      subject: `Collaboration with ${creator.displayName || creator.handle || "your content"}`,
    });

    await submitCreatorAutomationAction(
      creatorId,
      payload,
      {
        status: "queueing",
        dryRun: false,
        allowSend: true,
      },
      "已回写为已联系",
      "发送回写",
    );
  }

  function toggleCreatorStar(creatorId) {
    setCreatorList((current) =>
      current.map((creator) =>
        creator.id === creatorId ? { ...creator, starred: !creator.starred } : creator,
      ),
    );
  }

  async function copyCreatorHandle(handle) {
    if (!handle) return;
    try {
      if (await writeClipboardText(`@${handle}`)) {
        showToast("已复制 TikTok 账号");
      } else {
        showToast("复制失败", "failed");
      }
    } catch {
      showToast("复制失败", "failed");
    }
  }

  async function copyCreatorOutreachDraft(creatorId) {
    const creator = creatorList.find((item) => item.id === creatorId);
    const draft = creator?.automation?.outreach?.draft;
    if (!draft) {
      showToast("请先生成草稿", "failed");
      return;
    }

    try {
      if (await writeClipboardText(draft)) {
        showToast("IG 草稿已复制");
      } else {
        showToast("复制失败", "failed");
      }
    } catch {
      showToast("复制失败", "failed");
    }
  }

  function importCreatorLeads(importedCreators, fileName) {
    setCreatorList((current) => {
      const incomingById = new Map(importedCreators.map((creator) => [creator.id, creator]));
      const updatedCurrent = current.map((creator) => incomingById.get(creator.id) ?? creator);
      const existingIds = new Set(current.map((creator) => creator.id));
      const newItems = importedCreators.filter((creator) => !existingIds.has(creator.id));

      return [...updatedCurrent, ...newItems];
    });
    setSelectedCreatorId(importedCreators[0]?.id);
    setActiveSection("creators");
    showToast(`已导入 ${importedCreators.length} 个 EchoTik 达人：${fileName}`);
  }

  function clearImportedCreators() {
    setCreatorList((current) =>
      current.filter(
        (creator) =>
          realSeedCreatorIds.has(creator.id),
      ),
    );
    setSelectedCreatorId(null);
    showToast("已清空新导入/同步达人，历史达人已保留");
  }

  const syncEchoTikData = useCallback(
    async function syncEchoTikData() {
      if (isSyncing) return;
      setIsSyncing(true);
      try {
        const influencerById = new Map();
        const keywordHitsById = new Map();

        const syncErrors = [];

        for (const keyword of creatorSearchKeywords) {
          try {
            const result = await fetchInfluencerList({
              region: "US",
              pageNum: 1,
              minFollowers: 1000,
              keyword,
            });

          result.list.forEach((influencer) => {
            const key = influencer.id || influencer.rawId || influencer.handle;
            if (!key) return;

            if (!influencerById.has(key)) {
              influencerById.set(key, influencer);
            }

            const keywordHits = keywordHitsById.get(key) ?? new Set();
            keywordHits.add(keyword);
            keywordHitsById.set(key, keywordHits);
          });
          } catch (error) {
            const message = error instanceof Error ? error.message : "EchoTik 同步失败";
            syncErrors.push(`${keyword}: ${message}`);

            if (/usage limit|quota/i.test(message)) {
              break;
            }
          }
        }

        const leads = [...influencerById.entries()].map(([key, influencer]) => {
          const lead = mapInfluencerToCreatorLead(influencer, { keywords: creatorSearchKeywords });
          const queryKeywordHits = [...(keywordHitsById.get(key) ?? [])];

          return {
            ...lead,
            matchedKeywords: [...new Set([...(lead.matchedKeywords ?? []), ...queryKeywordHits])],
          };
        });

        if (leads.length === 0) {
          throw new Error(syncErrors[0] || "EchoTik 未返回可用达人，请稍后重试或导入 CSV/Excel");
        }

        setCreatorList((current) => {
          const incomingById = new Map(leads.map((lead) => [lead.id, lead]));
          const updatedCurrent = current.map((creator) =>
            incomingById.has(creator.id)
              ? {
                  ...incomingById.get(creator.id),
                  contact: {
                    ...incomingById.get(creator.id).contact,
                    instagram: creator.contact?.instagram ?? incomingById.get(creator.id).contact?.instagram ?? "",
                    notes: creator.contact?.notes || incomingById.get(creator.id).contact?.notes,
                  },
                  crmStatus: creator.crmStatus,
                  recentVideos: creator.recentVideos?.length ? creator.recentVideos : incomingById.get(creator.id).recentVideos,
                  highPerformingCoverUrl: creator.highPerformingCoverUrl || incomingById.get(creator.id).highPerformingCoverUrl,
                  videoDetailsFetched: creator.videoDetailsFetched,
                }
              : creator,
          );
          const existingIds = new Set(current.map((creator) => creator.id));
          const newItems = leads.filter((lead) => !existingIds.has(lead.id));

          return [...updatedCurrent, ...newItems];
        });

        if (leads.length > 0 && !selectedCreatorId) {
          setSelectedCreatorId(leads[0].id);
        }

        const now = new Date();
        setLastSync(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
        showToast(syncErrors.length ? `同步 ${leads.length} 个达人，部分关键词失败` : `同步 ${leads.length} 个 EchoTik 关键词达人`);
      } catch (error) {
        showToast(`同步失败: ${error.message}`, "failed");
      } finally {
        setIsSyncing(false);
      }
    },
    [isSyncing, selectedCreatorId],
  );

  useEffect(() => {
    const creator = creatorList.find((item) => item.id === selectedCreatorId);

    if (
      !creator?.rawId ||
      creator.videoDetailsFetched ||
      creator.videoDetailsLoading ||
      (creator.recentVideos ?? []).length > 0
    ) {
      return undefined;
    }

    let cancelled = false;

    setCreatorList((current) =>
      current.map((item) =>
        item.id === creator.id
          ? {
              ...item,
              videoDetailsLoading: true,
            }
          : item,
      ),
    );

    fetchInfluencerVideos(creator.rawId, { pageNum: 1, sortField: 1, sortType: 1 })
      .then((videos) => {
        if (cancelled) return;

        const recentVideos = mapFetchedVideos(videos.list.slice(0, 10));

        setCreatorList((current) =>
          current.map((item) => {
            if (item.id !== creator.id) {
              return item;
            }

            const videoWarnings = recentVideos.length > 0 ? [] : ["视频接口返回空"];
            const sourceDataWarnings = [
              ...(item.sourceDataWarnings ?? []).filter((warning) => !warning.includes("视频")),
              ...videoWarnings,
            ];

            return {
              ...item,
              recentVideos,
              highPerformingCoverUrl: recentVideos.find((video) => video.coverUrl)?.coverUrl || item.highPerformingCoverUrl,
              sourceDataWarnings,
              videoDetailsFetched: true,
              videoDetailsLoading: false,
            };
          }),
        );
      })
      .catch(() => {
        if (cancelled) return;

        setCreatorList((current) =>
          current.map((item) =>
            item.id === creator.id
              ? {
                  ...item,
                  sourceDataWarnings: [
                    ...(item.sourceDataWarnings ?? []).filter((warning) => !warning.includes("视频")),
                    "视频接口拉取失败",
                  ],
                  videoDetailsFetched: true,
                  videoDetailsLoading: false,
                }
              : item,
          ),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [creatorList, selectedCreatorId]);

  function showToast(message, tone = "copied") {
    setToastState({ message, tone });
    window.setTimeout(() => setToastState(null), 1600);
  }

  function runAutomation(taskId) {
    updateTaskStatus(taskId, "processing");
    showToast("自动化已启动");
  }

  function sendScript(taskId) {
    updateTaskStatus(taskId, "processing");
    showToast("消息已加入一键发送队列");
  }

  function renderContent() {
    if (activeSection === "dashboard") {
      return (
        <Dashboard
          filters={filters}
          groupedTasks={groupedTasks}
          metrics={metrics}
          onFilterChange={updateFilter}
          onSelectTask={setSelectedTaskId}
          selectedTaskId={selectedTask?.id}
          taskCount={visibleTasks.length}
        />
      );
    }

    if (activeSection === "settings") {
      return <SettingsPage />;
    }

    if (activeSection === "creators") {
      return (
        <CreatorPage
          creators={creatorList}
          filters={creatorFilters}
          onClearImported={clearImportedCreators}
          onContactChange={updateCreatorContact}
          onCopyHandle={copyCreatorHandle}
          onFilterChange={updateCreatorFilter}
          onImport={() => setShowImportModal(true)}
          onSelectCreator={setSelectedCreatorId}
          onStarToggle={toggleCreatorStar}
          onStatusChange={updateCreatorCrmStatus}
          selectedCreatorId={selectedCreator?.id}
        />
      );
    }

    return (
      <ModulePage
        moduleId={activeSection}
        onSelectTask={setSelectedTaskId}
        selectedTaskId={selectedTask?.id}
        tasks={taskList}
      />
    );
  }

  return (
    <div className="app-shell">
      <Sidebar activeSection={activeSection} onSelect={setActiveSection} />
      <div className="workbench">
        <Topbar
          activeSection={activeSection}
          isSyncing={isSyncing}
          lastSync={lastSync}
          onOpenImport={() => setShowImportModal(true)}
          onSyncEchoTik={syncEchoTikData}
        />
        {toastState ? (
          <div className={`toast ${toastState.tone}`}>{toastState.message}</div>
        ) : null}
        {renderContent()}
      </div>
      {activeSection === "creators" ? (
        <CreatorDetailDrawer
          creator={selectedCreator}
          isAutomationRunning={creatorAutomationBusyId === selectedCreator?.id}
          onConfirmOutreachDraft={confirmCreatorOutreachDraft}
          onContactChange={updateCreatorContact}
          onCopyOutreachDraft={copyCreatorOutreachDraft}
          onQueueOutreachDraft={queueCreatorOutreachDraft}
          onRecordOutreachSent={recordCreatorOutreachSent}
          onStatusChange={updateCreatorCrmStatus}
        />
      ) : (
        <DetailDrawer
          onRunAutomation={runAutomation}
          onSendScript={sendScript}
          onUpdateStatus={updateTaskStatus}
          task={selectedTask}
        />
      )}
      {showImportModal ? (
        <ImportModal
          onClose={() => setShowImportModal(false)}
          onCreatorImport={importCreatorLeads}
          variant={activeSection === "creators" ? "creators" : "operations"}
        />
      ) : null}
    </div>
  );
}
