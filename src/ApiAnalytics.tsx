import { useState } from "react";
import { apiAnalytics } from "./analytics";
import { BalanceBars, TrendChart } from "./Charts";
import { number, SectionHeader, shortNumber } from "./components";
import type { ApiStatus } from "./types";

export function ApiAnalytics({ status }: { status: ApiStatus }) {
  const [days, setDays] = useState(7),
    [metric, setMetric] = useState("requests");
  const data = apiAnalytics(status.recent, days);
  return (
    <section className="api-analytics data-section">
      <SectionHeader
        title="请求分析"
        detail="基于最近 100 条请求元数据 · 北京日期"
      >
        <div className="tabs" aria-label="API 分析周期">
          {[7, 30].map((value) => (
            <button
              key={value}
              aria-pressed={days === value}
              className={days === value ? "selected" : ""}
              onClick={() => setDays(value)}
            >
              {value} 天
            </button>
          ))}
        </div>
      </SectionHeader>
      <div className="api-analysis-layout">
        <div>
          <div className="analysis-metrics">
            <div>
              <small>区间请求</small>
              <strong>{number(data.requests)}</strong>
            </div>
            <div>
              <small>成功率</small>
              <strong>
                {data.successRate === null ? "—" : `${data.successRate}%`}
              </strong>
            </div>
            <div>
              <small>P50 延迟</small>
              <strong>
                {data.p50 === null ? "—" : `${number(data.p50 / 1000, 2)} s`}
              </strong>
            </div>
            <div>
              <small>P95 延迟</small>
              <strong>
                {data.p95 === null ? "—" : `${number(data.p95 / 1000, 2)} s`}
              </strong>
            </div>
          </div>
          <div className="chart-mode">
            <span>
              {metric === "requests" ? "每日请求量" : "每日已知 Token"}
            </span>
            <div className="tabs" aria-label="API 图表指标">
              <button
                aria-pressed={metric === "requests"}
                className={metric === "requests" ? "selected" : ""}
                onClick={() => setMetric("requests")}
              >
                请求量
              </button>
              <button
                aria-pressed={metric === "tokens"}
                className={metric === "tokens" ? "selected" : ""}
                onClick={() => setMetric("tokens")}
              >
                Token
              </button>
            </div>
          </div>
          <TrendChart
            title="API 请求趋势"
            points={
              metric === "requests" ? data.requestSeries : data.tokenSeries
            }
            unit={metric === "requests" ? "次" : "Tokens"}
            empty={!data.requests}
            emptyText="暂无 API 请求记录"
          />
        </div>
        <div className="api-model-analysis">
          <h3>模型调用分布</h3>
          <BalanceBars
            title="API 模型调用分布"
            unit="次"
            rows={data.models
              .slice(0, 4)
              .map((model) => ({
                label: model.label,
                value: model.value,
                detail: `${shortNumber(model.tokens)} 已知 Tokens${model.unknown ? ` · ${model.unknown} 次用量未知` : ""}`,
              }))}
          />
          <p className="chart-footnote">
            {shortNumber(data.tokens)} 已知 Tokens
            {data.unknown ? ` · ${data.unknown} 次用量未返回` : ""}
            。累计用量见上方，图表仅覆盖保留的请求。
          </p>
        </div>
      </div>
    </section>
  );
}
