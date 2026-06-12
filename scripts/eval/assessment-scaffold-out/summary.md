# Assessment-scaffold spike

model: `openai/gpt-5.4-mini` · K=3 · arms: baseline, disposition, broadened, completion-first

```
metric                    baseline          disposition       broadened         completion-first  
--------------------------------------------------------------------------------------------------
overall accuracy          26/30 (87%)       28/30 (93%)       25/30 (83%)       24/30 (80%)       
  review                  6/6 (100%)        6/6 (100%)        6/6 (100%)        6/6 (100%)        
  triage                  3/3 (100%)        2/3 (67%)         1/3 (33%)         1/3 (33%)         
  guard-research          3/3 (100%)        3/3 (100%)        3/3 (100%)        3/3 (100%)        
  guard-common            14/18 (78%)       17/18 (94%)       15/18 (83%)       14/18 (78%)       
research over-fire        3/24 (13%)        1/24 (4%)         2/24 (8%)         1/24 (4%)         
```
