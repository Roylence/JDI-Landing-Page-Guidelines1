const collections = await relay.variables.getLocalVariableCollectionsAsync();
const variables = await relay.variables.getLocalVariablesAsync();
const page = relay.root.children.find(p => p.id === '0:2');
await relay.setCurrentPageAsync(page);
const categoryLabelIds = new Set(['7:5952','7:5955','7:5958','7:5961','7:5964','7:5967','7:5970','7:5973','7:5979','7:5976','7:5982','7:5985','7:5988','7:5991']);
function textTree(n) {
  if (n.visible === false) return null;
  if (n.type === 'TEXT') return {id:n.id,name:n.name,kind:'text',text:n.characters,fontSize:typeof n.fontSize === 'number' ? n.fontSize : null};
  const children = 'children' in n ? n.children.map(textTree).filter(Boolean) : [];
  return children.length ? {id:n.id,name:n.name,kind:'group',children} : null;
}
return {
  exportedAt: new Date().toISOString(),
  collections: collections.map(c=>({id:c.id,name:c.name,defaultModeId:c.defaultModeId,modes:c.modes})),
  variables: variables.map(v=>({id:v.id,name:v.name,resolvedType:v.resolvedType,variableCollectionId:v.variableCollectionId,valuesByMode:v.valuesByMode})),
  sections: page.children.filter(n=>n.type==='SECTION').map(s=>({id:s.id,name:s.name,modules:s.children.filter(n=>n.visible!==false && !categoryLabelIds.has(n.id) && n.type!=='SLICE').map(n=>({id:n.id,name:n.name,tree:textTree(n)}))}))
};
