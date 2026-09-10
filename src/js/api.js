/** Thin promise wrappers over the preload bridge. */
const API = {
  call(method, ...args) {
    return window.researchai.call(method, ...args).then((r) => {
      if (!r.ok) throw new Error(r.error || 'Unknown error');
      return r.result;
    });
  },
  // system
  ping: () => API.call('ping'),
  getSettings: () => API.call('getSettings'),
  saveSettings: (patch) => API.call('saveSettings', patch),
  listModels: (cfg) => API.call('listModels', cfg),
  testLLM: (cfg) => API.call('testLLM', cfg),
  testEmbed: (cfg) => API.call('testEmbed', cfg),
  openDataFolder: () => API.call('openDataFolder'),
  // projects
  listProjects: () => API.call('listProjects'),
  createProject: (name, desc, rq) => API.call('createProject', name, desc, rq),
  deleteProject: (id) => API.call('deleteProject', id),
  updateProject: (id, patch) => API.call('updateProject', id, patch),
  getProject: (id) => API.call('getProject', id),
  setResearchQuestion: (id, rq) => API.call('setResearchQuestion', id, rq),
  pickFiles: () => API.call('pickFiles'),
  addFiles: (pid, paths) => API.call('addFiles', pid, paths),
  listDocuments: (pid) => API.call('listDocuments', pid),
  deleteDocument: (pid, docId) => API.call('deleteDocument', pid, docId),
  getDocument: (pid, docId) => API.call('getDocument', pid, docId),
  searchLibrary: (pid, q, k) => API.call('searchLibrary', pid, q, k),
  // chat
  chat: (params) => API.call('chat', params),
  cancel: (requestId) => API.call('cancel', requestId),
  // workflows
  runWorkflow: (params) => API.call('workflow', params),
  // discover
  searchAcademic: (q, opts) => API.call('searchAcademic', q, opts),
  importPaper: (pid, paper) => API.call('importPaper', pid, paper),
  // references
  listReferences: (pid) => API.call('listReferences', pid),
  addReference: (pid, ref) => API.call('addReference', pid, ref),
  importReferencesText: (pid, text, fmt) => API.call('importReferencesText', pid, text, fmt),
  importReferencesFile: (pid, path) => API.call('importReferencesFile', pid, path),
  deleteReference: (pid, refId) => API.call('deleteReference', pid, refId),
  formatReferences: (pid, style) => API.call('formatReferences', pid, style),
  exportReferences: (pid, fmt) => API.call('exportReferences', pid, fmt),
  // data lab
  loadTable: (path) => API.call('loadTable', path),
  analyze: (path, analysis, params) => API.call('analyze', path, analysis, params),
  // export
  saveTextFile: (name, content, filters) => API.call('saveTextFile', name, content, filters),
  pathForFile: (file) => window.researchai.pathForFile(file),
  on: (type, cb) => window.researchai.on(type, cb)
};
