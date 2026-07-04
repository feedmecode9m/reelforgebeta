# Backend Cleanup: Remove Fake Thumbnail Generation

## Problem
Backend appends `.jpg` to uploaded filenames.

## Fix
Find and delete code that does `filename + ".jpg"`.

## Clean Up
cd ~/projects/reelforge/backend/public/thumbs && rm -f *.jpg

## Response Format
{ id, name, type, url: "/thumbs/filename", size }
