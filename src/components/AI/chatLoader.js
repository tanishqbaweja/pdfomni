let chatSidebarPromise

export function loadChatSidebar() {
  chatSidebarPromise ||= import('./ChatSidebar')
  return chatSidebarPromise
}

export function preloadChatSidebar() {
  void loadChatSidebar()
}
