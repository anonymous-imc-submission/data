# Manual Measurements

 - `measurements.feather`: The raw data of our user study. Feather files can be easily imported into Python and R. Here's an excerpt from the data:

|      |   ID | URL                           | Has Consent Dialog?   | Has Ads?     | Comment   | Consent Strategy   | Operating System   | Browser   | Browser Profile   | Language   | location             |
|-----:|-----:|:------------------------------|:----------------------|:-------------|:----------|:-------------------|:-------------------|:----------|:------------------|:-----------|:---------------------|
|    0 |    1 | https://www.windowspro.de     | yes                   | generic      | <NA>      | accept             | Windows            | Chrome    | existing          | de         | in class             |
|    1 |    1 | https://www.boerse-online.de  | yes                   | personalized | <NA>      | accept             | Windows            | Chrome    | existing          | de         | in class             |
| 3176 |   67 | https://www.harpersbazaar.de/ | yes                   | no           | <NA>      | reject simple      | Windows            | Edge      | existing          | en         | from home (repeated) |
| 3177 |   67 | https://www.noz.de            | yes                   | generic      | <NA>      | reject simple      | Windows            | Edge      | existing          | en         | from home (repeated) |

 - `stats.ipynb`: Exploratory data analysis and generation o the `barplots-*.tex` files.
 - `results-manual*.tex`: Our TikZ code to generate the plots in the paper.
 - `study-briefing`: The briefing document provided to student raters.
