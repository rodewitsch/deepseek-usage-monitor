import { STATUS_ENDPOINT, STATUS_PAGE_URL } from './constants.js';

/**
 * DeepSeek service status, read from the public status page
 * (https://status.deepseek.com — powered by Flashduty).
 *
 * The page exposes its data as JSON at `/api/status-page/<pageId>/summary/active`.
 * That endpoint sends no CORS headers, so it can only be fetched by the service
 * worker, which has `host_permissions` for the status host.
 *
 * Payload shape (verified live):
 *   { data: {
 *       page: { name, components: [{ component_id, name, description, section_id? }] },
 *       active_changes: [{
 *         change_id, type: 'incident' | 'maintenance', title, description,
 *         status, start_at_seconds,
 *         affected_components: [{ component_id, name, status }],
 *         updates: [{ at_seconds, status, description, component_changes: [...] }]
 *       }]
 *   } }
 */

/** Most severe first. `partial_outage` and `degraded` both mean "trouble". */
const SEVERITY = {
  operational: 0,
  degraded: 1,
  partial_outage: 2,
  full_outage: 3,
  maintenance: 1,
  unknown: 1,
};
const TROUBLE = 2;

const INCIDENT_SEVERITY = {
  investigating: 3,
  identified: 3,
  monitoring: 2,
  scheduled: 2,
  in_progress: 2,
  resolved: 0,
  completed: 0,
};

/**
 * Fetches and normalises the status page. Never throws: a failed request
 * returns `{ ok: false, error }` so the caller keeps the previous status.
 */
export async function fetchServiceStatus({ timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(STATUS_ENDPOINT, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const payload = await response.json();
    return { ok: true, status: normaliseStatus(payload) };
  } catch (error) {
    return { ok: false, error: error?.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turns the Flashduty payload into a small, stable object:
 * `{ level, indicator, components[], incidents[], url, checkedAt }`.
 *
 * `level` is `operational | degraded | partial_outage | full_outage` and is the
 * worst component state (an active incident can only lower it).
 */
export function normaliseStatus(payload) {
  const data = payload?.data || {};
  const components = Array.isArray(data.page?.components) ? data.page.components : [];
  const changes = Array.isArray(data.active_changes) ? data.active_changes : [];

  // Component state = worst state reported by any active change for it.
  const byComponent = new Map();
  for (const change of changes) {
    const entries = Array.isArray(change?.affected_components) ? change.affected_components : [];
    for (const entry of entries) {
      if (!entry?.component_id) continue;
      const level = normaliseComponentStatus(entry.status);
      const current = byComponent.get(entry.component_id);
      if (!current || severityOf(level) > severityOf(current.level)) {
        byComponent.set(entry.component_id, { level, name: entry.name || current?.name || '' });
      }
    }
  }

  const list = components
    .filter((component) => !component.hide_all)
    .map((component) => {
      const reported = byComponent.get(component.component_id);
      return {
        id: component.component_id,
        name: component.name || '',
        sectionId: component.section_id || null,
        level: reported?.level || 'operational',
      };
    })
    .sort((a, b) => severityOf(b.level) - severityOf(a.level));

  const incidents = changes
    .map((change) => {
      const updates = Array.isArray(change?.updates) ? change.updates : [];
      const latest = updates[updates.length - 1] || null;
      const status = String(latest?.status || change?.status || '').toLowerCase();
      const title = stripBilingual(String(change?.title || ''));
      return {
        id: String(change?.change_id || ''),
        kind: change?.type === 'maintenance' ? 'maintenance' : 'incident',
        title,
        status,
        severity: INCIDENT_SEVERITY[status] ?? 2,
        updatedAt: Number(latest?.at_seconds || change?.start_at_seconds || 0) * 1000 || null,
        summary: stripBilingual(String(latest?.description || change?.description || '')).slice(0, 240),
        components: (Array.isArray(change?.affected_components) ? change.affected_components : [])
          .filter((entry) => normaliseComponentStatus(entry?.status) !== 'operational')
          .map((entry) => entry.name)
          .filter(Boolean),
      };
    })
    .filter((incident) => incident.severity > 0)
    .sort((a, b) => b.severity - a.severity);

  let level = list.reduce(
    (worst, component) => (severityOf(component.level) > severityOf(worst) ? component.level : worst),
    'operational',
  );
  if (incidents.length && level === 'operational') level = 'degraded';

  return {
    level,
    indicator: level === 'operational' ? 'none' : level === 'degraded' ? 'minor' : 'major',
    components: list,
    incidents: incidents.slice(0, 3),
    url: STATUS_PAGE_URL,
    checkedAt: Date.now(),
  };
}

function normaliseComponentStatus(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'full_outage' || value === 'major_outage' || value === 'outage') return 'full_outage';
  if (value === 'partial_outage' || value === 'degraded' || value === 'maintenance') {
    return value === 'maintenance' ? 'degraded' : value;
  }
  if (value === 'operational' || value === 'up' || value === 'ok') return 'operational';
  return 'unknown';
}

function severityOf(level) {
  return SEVERITY[level] ?? SEVERITY.unknown;
}

/** True when the status needs the user's attention (badge icon / banner). */
export function statusHasTrouble(status) {
  return status ? severityOf(status.level) >= TROUBLE : false;
}

/** Strips the `中文（English）` duplication used by the DeepSeek status page. */
function stripBilingual(text) {
  const trimmed = text.trim();
  const match = trimmed.match(/^([\s\S]+?)\s*[（(]([\s\S]+)[）)]\s*$/);
  if (!match) return trimmed;
  const [, chinese, english] = match;
  // Only drop the Chinese half when an English translation follows it.
  return /[\u4e00-\u9fff]/.test(chinese) && !/[\u4e00-\u9fff]/.test(english) ? english.trim() : trimmed;
}
