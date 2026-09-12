export function subagentTranscriptPage(
  items: ReadonlyArray<{ id: string; type: string; text: string }>,
  offset: number,
) {
  const steps = [];
  let index = 0;
  for (const item of items) {
    const count = Math.max(1, Math.ceil(item.text.length / 8000));
    for (let part = Math.max(0, offset - index); part < count && steps.length < 20; part++) {
      const start = part * 8000;
      steps.push({
        id: `${item.id}:part:${start}`,
        type: item.type,
        text: item.text.slice(start, start + 8000),
      });
    }
    index += count;
  }
  return { steps, ...(offset + steps.length < index ? { nextOffset: offset + steps.length } : {}) };
}
