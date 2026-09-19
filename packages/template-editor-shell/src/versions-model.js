export function versionsModel(groups, group) {
  const selected = groups.find(item => item.id === group) || groups.find(item => item.rows.length) || groups[0] || null;
  return { selected, segments: groups.map(item => ({ id: item.id, label: item.label, count: item.count ?? item.rows.length })), rows: selected?.rows || [], empty: selected && !selected.rows.length ? selected.empty : null };
}
