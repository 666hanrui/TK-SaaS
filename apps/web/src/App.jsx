import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  FileSpreadsheet,
  Filter,
  Headphones,
  Home,
  Inbox,
  Mail,
  PackageCheck,
  RefreshCw,
  Search,
  Send,
  Settings,
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
import { fetchInfluencerList, fetchInfluencerVideos, ECHOTIK_PAGE_SIZE, mapInfluencerToCreatorLead } from "./lib/echotikApi";
import { runShippingSweep } from "./lib/shippingApi";

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

const creatorNow = new Date("2026-07-06T09:00:00+08:00");

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

function formatMetricDelta(value, direction = "up") {
  return `${direction === "down" ? "↓" : "↑"} ${value}`;
}

function formatCompactNumber(value) {
  if (value >= 10000) {
    return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万`;
  }

  return value.toLocaleString("en-US");
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
    ""
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

    return normalizeEchoTikCreatorRows(utils.sheet_to_json(firstSheet, { defval: "" }), {
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
          2026-07-06（周一）
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
                  : "点击从 EchoTik 同步"}
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
      <div className="creator-cell creator-cell-number">{creator.likesFollowerRatio.toFixed(2)}</div>
      <div className="creator-cell creator-cell-number">{formatCompactNumber(creator.totalVideoCount)}</div>
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
          {visibleCreators.map((creator) => (
            <CreatorTableRow
              creator={creator}
              isSelected={creator.id === selectedCreatorId}
              key={creator.id}
              onCopy={onCopyHandle}
              onSelect={onSelectCreator}
              onStar={onStarToggle}
            />
          ))}
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
      alt={`${creator.displayName} 高播放视频封面`}
      referrerPolicy="no-referrer"
      src={src}
      onError={() => setFailed(true)}
    />
  );
}

function CreatorDetailDrawer({ creator, onContactChange, onStatusChange }) {
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
  const nextStage = getNextCreatorStage(creator.crmStatus);
  const checklist = [
    ["打开 TikTok 主页", Boolean(profileUrl)],
    ["确认公开邮箱", Boolean(creator.contact?.email)],
    ["确认 Instagram / Linktree", Boolean(creator.contact?.instagram)],
    ["确认内容符合黑人女性发型类目", evaluation.keywordCount > 0],
    ["确认曾出现商品关联视频", evaluation.productVideoCount > 0],
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
            <Field label="商品关联" value={`${evaluation.productVideoCount} 条视频`} />
            <Field label="社交账号" value={creator.contact?.socialAccount || "--"} />
            <Field label="来源" value={creator.source} />
          </dl>
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
            <Pill tone="neutral">预留</Pill>
          </div>
          <p>暂不生成或发送外联内容。联系方式确认后，这里会承接寄样或 affiliate 首轮草稿。</p>
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
  const [creatorList, setCreatorList] = useState([]);
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
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState("");
  const initialSyncDone = useRef(false);

  const metrics = useMemo(() => calculateDashboardMetrics(taskList), [taskList]);
  const visibleTasks = useMemo(() => filterTasks(taskList, filters), [taskList, filters]);
  const groupedTasks = useMemo(() => groupTasksByShift(visibleTasks), [visibleTasks]);
  const selectedTask = taskList.find((task) => task.id === selectedTaskId) ?? taskList[0];
  const selectedCreator =
    creatorList.find((creator) => creator.id === selectedCreatorId) ?? creatorList[0];

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
      await navigator.clipboard.writeText(`@${handle}`);
      showToast("已复制 TikTok 账号");
    } catch {
      showToast("复制失败", "failed");
    }
  }

  function importCreatorLeads(importedCreators, fileName) {
    setCreatorList((current) => {
      const existingIds = new Set(current.map((c) => c.id));
      const newItems = importedCreators.filter((c) => !existingIds.has(c.id));
      return [...current, ...newItems];
    });
    setSelectedCreatorId(importedCreators[0]?.id);
    setActiveSection("creators");
    showToast(`已导入 ${importedCreators.length} 个 EchoTik 达人：${fileName}`);
  }

  function clearImportedCreators() {
    setCreatorList((current) => current.filter((c) => !c.source?.startsWith("EchoTik export:")));
    setSelectedCreatorId(null);
    showToast("已清空所有 EchoTik 导入达人");
  }

  const syncEchoTikData = useCallback(
    async function syncEchoTikData() {
      if (isSyncing) return;
      setIsSyncing(true);
      try {
        const allInfluencers = [];
        for (let page = 1; page <= 10; page++) {
          const result = await fetchInfluencerList({ region: "US", pageNum: page, minFollowers: 1000 });
          allInfluencers.push(...result.list);
          if (result.list.length < ECHOTIK_PAGE_SIZE) break;
        }

        const leads = allInfluencers.map(mapInfluencerToCreatorLead);

        if (leads.length > 0) {
          for (const lead of leads.slice(0, 10)) {
            try {
              const videos = await fetchInfluencerVideos(lead.rawId, { pageNum: 1, sortField: 1, sortType: 1 });
              if (videos.list.length > 0) {
                lead.recentVideos = videos.list.slice(0, 10).map((v) => ({
                  id: v.id,
                  views: v.views,
                  createDate: v.createDate,
                  coverUrl: v.coverUrl,
                }));
                const bestCover = videos.list[0]?.coverUrl;
                if (bestCover) lead.highPerformingCoverUrl = bestCover;
              }
            } catch {
              // skip video fetch failures
            }
          }
        }

        setCreatorList((current) => {
          const existingIds = new Set(current.map((c) => c.id));
          const newItems = leads.filter((c) => !existingIds.has(c.id));
          if (newItems.length === 0) return current;
          return [...current, ...newItems];
        });

        if (leads.length > 0 && !selectedCreatorId) {
          setSelectedCreatorId(leads[0].id);
        }

        const now = new Date();
        setLastSync(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
        showToast(`同步 ${leads.length} 达人，US 区 1K+ 粉丝带视频封面`);
      } catch (error) {
        showToast(`同步失败: ${error.message}`, "failed");
      } finally {
        setIsSyncing(false);
      }
    },
    [isSyncing, selectedCreatorId],
  );

  useEffect(() => {
    if (activeSection === "creators" && !initialSyncDone.current) {
      initialSyncDone.current = true;
      syncEchoTikData();
    }
  }, [activeSection, syncEchoTikData]);

  function showToast(message, tone = "copied") {
    setToastState({ message, tone });
    window.setTimeout(() => setToastState(null), 1600);
  }

  async function runAutomation(taskId) {
    const task = taskList.find((item) => item.id === taskId);
    updateTaskStatus(taskId, "processing");
    if (task?.module !== "orders") {
      showToast("该模块执行适配器正在接入", "failed");
      return;
    }

    showToast("正在扫描并执行待发货订单");
    try {
      const result = await runShippingSweep();
      const failed = result.jobs.filter((job) => job.run_status !== "completed");
      if (failed.length > 0) {
        showToast(
          `完成 ${result.completed}/${result.discovered}，${failed.length} 个进入异常队列`,
          "failed",
        );
        return;
      }
      updateTaskStatus(taskId, "done");
      showToast(`全流程完成 ${result.completed}/${result.discovered} 单（${result.mode}）`);
    } catch (error) {
      updateTaskStatus(taskId, "open");
      showToast(error instanceof Error ? error.message : "发货自动化启动失败", "failed");
    }
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
          onContactChange={updateCreatorContact}
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
