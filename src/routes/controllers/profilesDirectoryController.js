const supabase = require('../db/supabase');

async function getCount(req, res) {
  const { count, error } = await supabase
    .from('profiles')
    .select('full_name', { count: 'exact', head: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ count });
}

async function getSample(req, res) {
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 5000);

  const { count, error: countErr } = await supabase
    .from('profiles')
    .select('full_name', { count: 'exact', head: true });
  if (countErr) return res.status(500).json({ error: countErr.message });

  const total = count || 0;
  const maxOffset = Math.max(0, total - limit);
  const offset = Math.floor(Math.random() * (maxOffset + 1));

  const { data, error } = await supabase
    .from('profiles')
    .select('full_name')
    .range(offset, offset + limit - 1);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

module.exports = { getCount, getSample };