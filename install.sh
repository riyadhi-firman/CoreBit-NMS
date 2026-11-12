#!/bin/bash
# Quick install wrapper - runs the kickstart script
cd "$(dirname "$0")"
sudo bash deploy/kickstart.sh --url "$(pwd)" "$@"
