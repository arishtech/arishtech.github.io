<?php
/**
 * The sidebar containing the main widget area
 *
 * @link https://developer.wordpress.org/themes/basics/template-files/#template-partials
 *
 * @package Restly
 */
if(is_page() || is_singular('post') || is_singular('restly_portfolio') || is_singular('restly_team') && get_post_meta($post->ID, 'restly_metabox', true)) {
    $restly_commonMeta = get_post_meta($post->ID, 'restly_metabox', true);
} else {
    $restly_commonMeta = array();
}


if(is_array($restly_commonMeta) && array_key_exists('restly_sidebar_meta', $restly_commonMeta)){
    $restly_selectedSidebar = $restly_commonMeta['restly_sidebar_meta'];
}else{
    $restly_selectedSidebar = 'sidebar';
}
?>
<div id="secondary" class="col-xl-4 col-lg-5 col-md-12 col-sm-12 col-12 sidebar-widget-area sidebar-bg">
<?php dynamic_sidebar($restly_selectedSidebar ); ?>
</div>
