function parseDate(input) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new RangeError('Expected YYYY-MM-DD');
  }
  const [year, month, day] = input.split('-').map(Number);
  // The live demo bug is here: Date.UTC expects a zero-based month.
  return new Date(Date.UTC(year, month, day));
}

module.exports = { parseDate };
