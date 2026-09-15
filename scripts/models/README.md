# Model info pipeline

Turns the styling team's look list into `custom.model_info` on Shopify —
"Model is 188cm tall and wearing a size M" — per colorway.

    parse_looks.py  model-products-list.rtf → looks.json
    match.py        looks.json + master colorways → matched.json
    resolve.py      matched.json + models.tsv → resolved.json
    push.py         creates/reuses `model` metaobjects, emits linking SQL

`models.tsv` holds the models' measurements; the look list is the RTF at the
repo root. `match.py` needs a TSV of master colorways:

```sql
select c.id, c."colorwaySku", st."styleName", c.name, st.category,
       coalesce(string_agg(distinct v."sizeLabel", ',' order by v."sizeLabel"),''),
       coalesce(string_agg(distinct s.code, ',' order by s.code),'')
from "Colorway" c
join "Style" st on st.id = c."styleId"
left join "Variant" v on v."colorwayId" = c.id
left join "SeasonEntry" se on se."colorwayId" = c.id
left join "Season" s on s.id = se."seasonId"
where not c.archived and c.kind = 'MERCHANDISE'
group by c.id, c."colorwaySku", st."styleName", c.name, st.category;
```

Every stage reports what it could not resolve rather than guessing — see
`docs/model-info.md` for the open items. `push.py` is a dry run without
`--apply`, and reuses a metaobject whose name already exists, so re-running
corrects rather than duplicating.
