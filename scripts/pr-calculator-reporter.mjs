export default async function* report(events) {
  for await (const event of events) yield `${JSON.stringify(event)}\n`;
}
