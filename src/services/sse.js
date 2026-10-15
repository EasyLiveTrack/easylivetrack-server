/**
 * Server-Sent Events (SSE) Subscriber Manager
 */

const sseClients = new Map();

function addSubscriber(sessionId, res) {
  if (!sseClients.has(sessionId)) {
    sseClients.set(sessionId, new Set());
  }
  const set = sseClients.get(sessionId);
  set.add(res);

  res.write(`data: ${JSON.stringify({ type: 'connected', sessionId })}\n\n`);

  res.on('close', () => {
    set.delete(res);
    if (set.size === 0) {
      sseClients.delete(sessionId);
    }
  });
}

function notifySubscribers(sessionId, data) {
  const clients = sseClients.get(sessionId);
  if (clients && clients.size > 0) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
      try {
        client.write(payload);
      } catch (err) {
        clients.delete(client);
      }
    }
  }
}

function getSubscribersCount(sessionId) {
  const clients = sseClients.get(sessionId);
  return clients ? clients.size : 0;
}

module.exports = {
  addSubscriber,
  notifySubscribers,
  getSubscribersCount
};
