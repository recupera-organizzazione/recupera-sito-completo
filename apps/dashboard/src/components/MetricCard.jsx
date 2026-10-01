// Card KPI: mostra solo valori passati da MetricGrid (API), nessun numero fisso.
// Decorazioni opzionali dai dati: progress (0-100) e tags (es. sigle ASL).

export default function MetricCard({ metric }) {
  const trendClass =
    metric.type === 'pressure'
      ? 'warning'
      : metric.type === 'confirmation'
        ? 'neutral'
        : 'positive';

  return (
    <article
      className={`metric-card ${metric.type === 'emphasis' ? 'emphasis' : ''}`}
      aria-label={`${metric.label}: ${metric.value} ${metric.unit || ''}`}
    >
      <div className="metric-head">
        <span>{metric.label}</span>
        {metric.trend && <span className={`trend ${trendClass}`}>{metric.trend}</span>}
      </div>
      <strong>
        {metric.value}
        {metric.unit && <span className="small-unit">{metric.unit}</span>}
      </strong>
      <p>{metric.note}</p>
      {metric.progress != null && (
        <div className="progress" aria-hidden="true">
          <i style={{ width: `${Math.min(metric.progress, 100)}%` }} />
        </div>
      )}
      {metric.tags?.length > 0 && (
        <div className="mini-tags" aria-hidden="true">
          {metric.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      )}
    </article>
  );
}
