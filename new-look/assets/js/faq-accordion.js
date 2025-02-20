/* faqs section js start*/
// FAQ accordian start //
jQuery(document).ready(function() {
  //toggle the component with class accordion_body
  jQuery('span.plusminus').empty();
  jQuery('.accordion_container .accordion_head span.plusminus').html('<i class="fa fa-plus"></i>');
  jQuery('.accordion_container .accordion_head:eq(0) span.plusminus').html('<i class="fa fa-minus"></i>');
  jQuery(document).on('click','.accordion_head',function() {
    if (jQuery('.accordion_body').is(':visible')) {
      jQuery('.accordion_body').slideUp(300);
      jQuery('.plusminus').html('<i class="fa fa-plus"></i>');
    }
    if (jQuery(this).children('.accordion_body').is(':visible')) {
      jQuery(this).children('.accordion_body').slideUp(300);
      jQuery(this).find('.plusminus').html('<i class="fa fa-plus"></i>');
    } else {
      jQuery(this).children('.accordion_body').slideDown(300);
      jQuery(this).find('.plusminus').html('<i class="fa fa-minus"></i>');
    }
  });
  
  if (jQuery(window).width() > 1024) {
        jQuery('.accordion_head').hover(function() {
          if (jQuery(this).children('.accordion_body').is(':visible')) {
          } else {
            jQuery(this).find('.plusminus').html('<i class="fa fa-minus"></i>').stop( true, true ).fadeOut(1000);
            jQuery(this).find('.plusminus').html('<i class="fa fa-minus"></i>').stop( true, true ).fadeIn(1000);      
          }
        });
        
        jQuery('.accordion_head').mouseout(function() {
          
          if (jQuery(this).children('.accordion_body').is(':visible')) {
          } else {
            jQuery(this).find('.plusminus').html('<i class="fa fa-plus"></i>').fadeIn(1000);
          }
        });

      }
});

jQuery(window).on("load resize",function(){
      
      if (jQuery(window).width() > 1024) {
        jQuery('.accordion_head').hover(function() {
          if (jQuery(this).children('.accordion_body').is(':visible')) {
          } else {
            jQuery(this).find('.plusminus').html('<i class="fa fa-minus"></i>').stop( true, true ).fadeOut(1000);
            jQuery(this).find('.plusminus').html('<i class="fa fa-minus"></i>').stop( true, true ).fadeIn(1000);      
          }
        });
        
        jQuery('.accordion_head').mouseout(function() {
          
          if (jQuery(this).children('.accordion_body').is(':visible')) {
          } else {
            jQuery(this).find('.plusminus').html('<i class="fa fa-plus"></i>').fadeIn(1000);
          }
        });

      }

  });
// FAQ accordian start //

/*faqs section js end */  