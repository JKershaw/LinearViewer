// No imports: routes/proxy-compute.js loads the sample data lazily, and this must not pull it in.

/**
 * A fixture issue's parent as the live providers' recommendation context carries it:
 * identifier, title, description and state (LIN-4345). Null for a top-level fixture.
 */
export function fixtureParent(issues, fixture) {
  const parent = fixture.parent?.id ? issues.find(i => i.id === fixture.parent.id) : null;
  if (!parent) return null;
  return {
    id: parent.id,
    identifier: parent.identifier || parent.id,
    title: parent.title,
    description: parent.description || '',
    state: parent.state
  };
}
