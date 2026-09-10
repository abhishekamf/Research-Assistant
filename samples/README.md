# Samples

- **sample_survey.csv** — synthetic dataset of 40 smallholder farmers (9 districts-free columns): demographics, extension visits, training, adoption score, yield, income and a 5-item Likert scale (q1–q5).

Load it in the **Data Lab** to explore:
- Descriptives → all numeric columns
- Correlations → training vs adoption vs yield
- Compare groups → `yield_kg_per_acre` by `district` (ANOVA)
- Regression → yield from farm size, visits, training, adoption
- Cronbach's α → tick `q1…q5` (the scale was simulated with high internal consistency)
- Chi-square → `district` × `loan_access`
