#!/usr/bin/env bash

set -e

echo "Cleaning Rust artifacts..."
cargo clean

echo "Fixing ownership..."
sudo chown -R $USER:$USER ~/projects/reelforge

echo "Removing frontend build..."
rm -rf ~/projects/reelforge/frontend/dist

echo "Done."
