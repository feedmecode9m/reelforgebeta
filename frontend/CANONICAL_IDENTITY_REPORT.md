# CANONICAL_IDENTITY_REPORT

Generated: 2026-07-13T06:34:28.543Z

## Result: PASS



| Domain | Result |
|--------|--------|
| Thumbnail | PASS |
| Video | PASS |
| Hero | PASS |
| Feed | PASS |
| Viewer | PASS |
| Placeholder | PASS |
| Studio | PASS |
| Reload | PASS |
| Persistence | PASS |
| Network | PASS |

## Rules verified

- No display-name URLs (`/thumbs/foo.png`, `/videos/name.mp4` unless allowlisted)
- No UUID reconstruction from display `name`
- No fallback URL reconstruction from labels
- No duplicate identity across storage keys

## Evidence

```json
{
  "Thumbnail": {
    "count": 2,
    "sample": {
      "id": "9cefa0d6-ccbb-494b-83b5-c8af45cbd9da",
      "fileName": "9cefa0d6-ccbb-494b-83b5-c8af45cbd9da.png",
      "name": "regression-thumb-2.png",
      "title": "regression-thumb-2.png",
      "url": "/thumbs/9cefa0d6-ccbb-494b-83b5-c8af45cbd9da.png",
      "size": 70,
      "type": "image",
      "addedAt": "2026-07-13T06:33:24.929Z"
    }
  },
  "Video": {
    "sample": {
      "id": "7a33c139-0b0e-476a-ad3e-c1951e061db9",
      "fileName": "7a33c139-0b0e-476a-ad3e-c1951e061db9.mp4",
      "url": "/videos/7a33c139-0b0e-476a-ad3e-c1951e061db9.mp4"
    }
  },
  "Hero": {
    "reel": {
      "id": "636d8e8f-239e-4dbe-95a8-6c2251eea0f1",
      "fileName": "636d8e8f-239e-4dbe-95a8-6c2251eea0f1.png",
      "name": "Regression Hero",
      "url": "/thumbs/636d8e8f-239e-4dbe-95a8-6c2251eea0f1.png",
      "type": "image",
      "backgroundSource": "custom_image"
    }
  },
  "Feed": {
    "reelCount": 4
  },
  "Viewer": {
    "images": 2,
    "videos": 2
  },
  "Placeholder": {
    "count": 0
  },
  "Studio": {
    "thumbCount": 2,
    "videoCount": 2,
    "heroId": "636d8e8f-239e-4dbe-95a8-6c2251eea0f1",
    "dupThumb": false,
    "dupVideo": false
  },
  "Reload": {
    "beforeReload": {
      "thumbs": 2,
      "videos": 2,
      "hero": "636d8e8f-239e-4dbe-95a8-6c2251eea0f1"
    },
    "afterReload": {
      "thumbs": 2,
      "videos": 2,
      "hero": "636d8e8f-239e-4dbe-95a8-6c2251eea0f1",
      "thumbSample": {
        "id": "9cefa0d6-ccbb-494b-83b5-c8af45cbd9da",
        "fileName": "9cefa0d6-ccbb-494b-83b5-c8af45cbd9da.png",
        "name": "regression-thumb-2.png",
        "title": "regression-thumb-2.png",
        "url": "/thumbs/9cefa0d6-ccbb-494b-83b5-c8af45cbd9da.png",
        "size": 70,
        "type": "image",
        "addedAt": "2026-07-13T06:33:24.929Z"
      }
    }
  },
  "Persistence": {
    "hero": {
      "id": "636d8e8f-239e-4dbe-95a8-6c2251eea0f1",
      "fileName": "636d8e8f-239e-4dbe-95a8-6c2251eea0f1.png",
      "name": "Regression Hero",
      "url": "/thumbs/636d8e8f-239e-4dbe-95a8-6c2251eea0f1.png",
      "type": "image",
      "backgroundSource": "custom_image"
    },
    "mgr": {
      "heroType": "TRENDING",
      "backgroundSource": "custom_image",
      "heroAssetId": "636d8e8f-239e-4dbe-95a8-6c2251eea0f1",
      "backgroundStyle": "image",
      "autoRotate": false,
      "rotateIntervalMs": 30000,
      "spotlightPriority": [
        "FEATURED_RELEASE",
        "CONTINUE_WATCHING",
        "TRENDING",
        "UPCOMING_PREMIERE",
        "TEAM_SPOTLIGHT",
        "STUDIO_PRIORITY"
      ],
      "seasonalCampaigns": [
        {
          "id": "winter-premiere",
          "label": "Winter Premiere Push",
          "heroType": "UPCOMING_PREMIERE",
          "active": false,
          "scheduleStart": "",
          "scheduleEnd": ""
        },
        {
          "id": "studio-sprint",
          "label": "Studio Sprint Spotlight",
          "heroType": "STUDIO_PRIORITY",
          "active": false,
          "scheduleStart": "",
          "scheduleEnd": ""
        }
      ],
      "carouselDurationMs": 8000,
      "carouselTransitionStyle": "fade",
      "carouselPriority": "video",
      "heroTypography": "cinematic",
      "autoplayEnabled": true,
      "carouselSlideOverrides": [
        {
          "type": "video",
          "order": 1,
          "durationMs": 8000,
          "enabled": true
        },
        {
          "type": "image",
          "order": 2,
          "durationMs": 8000,
          "enabled": true
        },
        {
          "type": "featured_release",
          "order": 3,
          "durationMs": 8000,
          "enabled": true
        },
        {
          "type": "admin_image",
          "order": 4,
          "durationMs": 8000,
          "enabled": true
        },
        {
          "type": "admin_video",
          "order": 5,
          "durationMs": 8000,
          "enabled": true
        },
        {
          "type": "upcoming_release",
          "order": 6,
          "durationMs": 8000,
          "enabled": true
        },
        {
          "type": "team_spotlight",
          "order": 7,
          "durationMs": 8000,
          "enabled": true
        },
        {
          "type": "marketplace_spotlight",
          "order": 8,
          "durationMs": 8000,
          "enabled": true
        },
        {
          "type": "revenue_milestone",
          "order": 9,
          "durationMs": 8000,
          "enabled": true
        },
        {
          "type": "creator_spotlight",
          "order": 10,
          "durationMs": 8000,
          "enabled": true
        },
        {
          "type": "discovery_recommendation",
          "order": 11,
          "durationMs": 8000,
          "enabled": true
        },
        {
          "type": "sentinel_recommendation",
          "order": 12,
          "durationMs": 8000,
          "enabled": true
        }
      ],
      "heroLabel": "LOOK@ZAKANDA PRESENTS",
      "heroTitle": "Black Warrior: Land, Legacy & Liberation",
      "heroSubtitle": "A cinematic spotlight on generational Black land stewardship.",
      "heroDescription": "Discover the families preserving generations of Black land ownership in Alabama.",
      "ctaPrimaryLabel": "Watch Now",
      "ctaPrimaryTarget": "/watch",
      "ctaSecondaryLabel": "Learn More",
      "ctaSecondaryTarget": "/series/neon-vengeance",
      "campaignType": "editorial_story",
      "featuredCollection": "Black Legacy Stories",
      "featuredSeries": "Neon Vengeance",
      "storyStatus": "draft",
      "storyScheduledFor": "",
      "updatedAt": 1783924446745
    },
    "legacyHero": false,
    "indexIsStrings": true,
    "indexCount": 2,
    "thumbCount": 2
  },
  "Network": {
    "violations": [],
    "bad404": []
  }
}
```

## Network violations

None

## Network 404s (canonical scope)

None
