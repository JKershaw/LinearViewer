# Assessment-scaffold spike

model: `openai/gpt-5.4-mini` · K=3 · arms: baseline, disposition, broadened, completion-first

```
metric                    baseline          disposition       broadened         completion-first  
--------------------------------------------------------------------------------------------------
overall accuracy          31/36 (86%)       33/36 (92%)       35/36 (97%)       35/36 (97%)       
  node                    4/6 (67%)         6/6 (100%)        6/6 (100%)        5/6 (83%)         
  review                  24/24 (100%)      24/24 (100%)      24/24 (100%)      24/24 (100%)      
  blocked                 2/3 (67%)         0/3 (0%)          3/3 (100%)        3/3 (100%)        
  implement               1/3 (33%)         3/3 (100%)        2/3 (67%)         3/3 (100%)        
research over-fire        1/36 (3%)         0/36 (0%)         0/36 (0%)         0/36 (0%)         
```
