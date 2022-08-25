# Automated Measurements

 - `runner/`: Our core browser instrumentation written in TypeScript based on Playwright.
 - `consent-test/`: Code and results for our consent dialog instrumentation tests.
 - `button-texts/`: Code to extract not-yet-known button labels fron testing our consent dialog instrumentation.
 - `eval/`: Raw results of our analyses and the associated TikZ code used to produce figures.
 - `search-results/`: Top search result URLs for the respective search terms.

### Additional Resources

We also provide the "glue code" we use to drive measurements on AWS, DigitalOcean and local VMs. This part is not immediately reproducible by its very nature, but readers may pick up a few tricks for their own measurements.

 - `requirements.txt`: The exact Python dependencies for all analyses.
 - `admeasure_py/`: Our Python CLI tool to run commands.
 - `base-image/`: Scripts to create VM images for runners
 - `log`: Utilitity tool to grep through a large number of runner logs.
