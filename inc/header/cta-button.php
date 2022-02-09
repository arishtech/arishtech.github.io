<?php 
$restly_cta_text = restly_options('restly_cta_text');
$restly_cta_select = restly_options('restly_cta_select');
$restly_cta_link = restly_options('restly_cta_link');
$restly_cta_page = restly_options('restly_cta_page');
if($restly_cta_select == 2 ){
    $cta_link = get_page_link($restly_cta_page);
}else{
    $cta_link = $restly_cta_link;
}
?>
<div class="button d-flex">
    <a href="<?php echo esc_url($cta_link); ?>" class="theme-btns"><?php echo esc_html($restly_cta_text); ?></a>
</div>