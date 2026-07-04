use crate::models::CategoryDetection;

pub struct SmartCategoryDetector;

impl SmartCategoryDetector {
    pub fn detect_from_title(title: &str) -> CategoryDetection {
        if title.is_empty() {
            return CategoryDetection {
                category: "Trending".to_string(),
                confidence: 65.0, // Fixed: float literal
                matched_keywords: vec![],
                suggested_categories: vec!["Trending".to_string(), "Cyber-Action".to_string()],
                is_auto_detected: true,
            };
        }

        let title_lower = title.to_lowercase();
        let keyword_map = vec![
            (
                "Trending",
                vec!["trending", "viral", "barbershop", "barber"],
            ),
            ("Cyber-Action", vec!["cyber", "hack", "action", "fight"]),
            ("Romance", vec!["love", "romance", "heart", "dating"]),
            ("Suspense", vec!["mystery", "thriller", "horror", "dark"]),
            ("Noir", vec!["noir", "detective", "crime", "rain"]),
        ];

        let mut scores: Vec<(String, i32, Vec<String>)> = keyword_map
            .iter()
            .map(|(category, keywords)| {
                let mut score = 0;
                let mut matched = Vec::new();
                for keyword in keywords {
                    if title_lower.contains(keyword) {
                        score += 1;
                        matched.push(keyword.to_string());
                    }
                }
                (category.to_string(), score, matched)
            })
            .collect();

        scores.sort_by(|a, b| b.1.cmp(&a.1));
        let (top_category, top_score, matched_keywords) = &scores[0];

        // Fixed: Ensure confidence calculation results in f64
        let confidence = if *top_score == 0 {
            65.0
        } else {
            (*top_score as f64 * 15.0).min(100.0)
        };

        let suggested_categories: Vec<String> = scores
            .iter()
            .take(3)
            .map(|(cat, _, _)| cat.clone())
            .collect();

        CategoryDetection {
            category: top_category.clone(),
            confidence,
            matched_keywords: matched_keywords.clone(),
            suggested_categories,
            is_auto_detected: true,
        }
    }

    pub fn analyze_video_metadata(_video_url: &str) -> serde_json::Value {
        serde_json::json!({
            "duration": 0,
            "resolution": "1920x1080",
            "format": "mp4",
            "analyzed_at": chrono::Utc::now().to_rfc3339()
        })
    }

    pub fn get_cultural_themes(title: &str) -> Vec<String> {
        let title_lower = title.to_lowercase();
        let mut themes = Vec::new();
        if title_lower.contains("barber") {
            themes.push("community".to_string());
        }
        if title_lower.contains("love") {
            themes.push("black-love".to_string());
        }
        if themes.is_empty() {
            themes.push("black-stories".to_string());
        }
        themes
    }
}
