export const UIAgent = {
    // Fills the UI if the backend is empty
    autoPopulate: (currentFeed) => {
        const categories = ["Trending", "Cyber-Noir", "Romance"];
        const ghosts = ["The Glitch", "Neon Pulse", "Digital Debt"];
        let virtualFeed = { ...currentFeed };

        categories.forEach(cat => {
            if (!virtualFeed[cat] || virtualFeed[cat].length < 3) {
                if (!virtualFeed[cat]) virtualFeed[cat] = [];
                virtualFeed[cat].push({
                    id: crypto.randomUUID(),
                    title: ghosts[Math.floor(Math.random() * ghosts.length)],
                    category: cat,
                    likes: "99k",
                    isGhost: true
                });
            }
        });
        return virtualFeed;
    },
    getImg: (title) => `https://loremflickr.com/400/600/cinema?lock=${title.length}`
};
