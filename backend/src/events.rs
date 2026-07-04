use chrono::{DateTime, Utc};
use tokio::sync::broadcast;

use crate::reel_contract::ReelV1;

#[derive(Clone, Debug)]
pub enum ReelEvent {
    Created(ReelV1),
    Deleted {
        id: String,
        title: String,
        category: String,
        deleted_at: DateTime<Utc>,
    },
}

#[derive(Clone)]
pub struct EventBus {
    sender: broadcast::Sender<ReelEvent>,
}

impl EventBus {
    pub fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity);
        Self { sender }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<ReelEvent> {
        self.sender.subscribe()
    }

    pub async fn publish(&self, event: ReelEvent) {
        let _ = self.sender.send(event);
    }
}
