#!/bin/bash

echo "🏆 Starting WinnersTrack..."
echo ""
echo "The app will open at: http://localhost:5001"
echo "Press Ctrl+C to stop the server"
echo ""

npx tsc

python3 app.py
